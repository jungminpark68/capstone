import argparse
from .fusion_model import FusionVerifier
from .serve import create_service


def main():
    parser=argparse.ArgumentParser(description='Serve only a learned fusion checkpoint; no paid inference API is used')
    parser.add_argument('--checkpoint',required=True)
    parser.add_argument('--port',type=int,default=8010)
    parser.add_argument('--device')
    parser.add_argument('--model-cache')
    args=parser.parse_args()
    import uvicorn
    model=FusionVerifier(args.checkpoint,device=args.device,model_cache=args.model_cache)
    uvicorn.run(create_service(model),host='127.0.0.1',port=args.port,workers=1)


if __name__=='__main__':main()
