import argparse
import base64
import io
import json
import re
import threading
from pathlib import Path
from . import BASE_MODEL, LABELS


def create_service(verifier):
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel, Field
    from PIL import Image
    class Fact(BaseModel):
        id: str = Field(min_length=1, max_length=100)
        text: str = Field(min_length=1, max_length=300)
    class Request(BaseModel):
        image: str = Field(max_length=6_000_000)
        scene: str = Field(min_length=1, max_length=3000)
        characters: str = Field(default="", max_length=3000)
        facts: list[Fact] = Field(min_length=1, max_length=16)
    app, lock = FastAPI(title="Memory Connect local fact verifier"), threading.Lock()
    @app.get("/health")
    def health():
        return {"ready": True, "model": str(verifier.adapter or verifier.base_model), "trainedModel": verifier.trained, "trainingScope":getattr(verifier,'training_scope','vlm_lora'), "externalInference": False}
    @app.post("/verify")
    def verify(request: Request):
        match = re.fullmatch(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)", request.image)
        if not match or len({fact.id for fact in request.facts}) != len(request.facts):
            raise HTTPException(400, "Invalid image or duplicate fact IDs")
        try:
            with Image.open(io.BytesIO(base64.b64decode(match[2], validate=True))) as raw:
                if raw.width*raw.height > 20_000_000:
                    raise ValueError("Excessive image dimensions")
                raw.load()
                image = raw.convert("RGB")
        except Exception as error:
            raise HTTPException(400, "Cannot decode a supported image") from error
        results = []
        with lock:
            if hasattr(verifier,'verify_image'):
                results=verifier.verify_image(image,request.scene,request.characters,[fact.model_dump() for fact in request.facts])
            else:
                for fact in request.facts:
                    text = verifier.text_for({"scene": request.scene, "characters": request.characters}, {"text": fact.text})
                    probabilities = verifier.probabilities(verifier.encode_images([text], [image]))[0]
                    label = LABELS[max(range(3), key=probabilities.__getitem__)]
                    results.append({"factId": fact.id, "label": label, "reason": f"자체 실행 모델의 사실별 분류: {label}. 실제 관찰 근거 영역은 별도 검증이 필요합니다."})
        return {"mode":getattr(verifier,'backend_mode',"local_finetuned" if verifier.trained else "local_pretrained"), "trainedModel": verifier.trained, "trainingScope":getattr(verifier,'training_scope','vlm_lora'), "model": str(verifier.adapter or verifier.base_model), "results": results}
    return app


def main():
    parser = argparse.ArgumentParser(description="Serve a local model; no OpenAI calls or dummy predictions")
    parser.add_argument("--adapter", required=True)
    parser.add_argument("--base-model", required=True)
    parser.add_argument("--four-bit", action="store_true")
    parser.add_argument("--port", type=int, default=8010)
    args = parser.parse_args()
    from .model import LocalVerifier
    import uvicorn
    config = json.loads((Path(args.adapter) / 'verifier_config.json').read_text())
    model = LocalVerifier(args.base_model, adapter=args.adapter, four_bit=args.four_bit, max_pixels=config.get('max_pixels', 200704))
    uvicorn.run(create_service(model), host="127.0.0.1", port=args.port, workers=1)


if __name__ == "__main__":
    main()
