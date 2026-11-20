import unittest
import torch
from diary_verifier.shared_encoder import EncoderSpec,EncodedText,FactFusionHead


class SharedEncoderTests(unittest.TestCase):
    def test_contract_and_real_gradient_with_placeholder_features(self):
        spec=EncoderSpec('SOFTWARE-TEST-ENCODER','v1',8,8,'mean',32)
        text=EncodedText(torch.randn(2,8),torch.randn(2,4,8),torch.tensor([[1,1,1,0],[1,1,0,0]],dtype=torch.bool),spec)
        image=torch.randn(2,6,10)
        head=FactFusionHead(spec,10,hidden=16,heads=2)
        logits=head(text,image)
        self.assertEqual(tuple(logits.shape),(2,3))
        loss=torch.nn.functional.cross_entropy(logits,torch.tensor([0,1]));loss.backward()
        self.assertTrue(head.image_projection.weight.grad.abs().sum()>0)
        self.assertTrue(head.text_projection.weight.grad.abs().sum()>0)

    def test_same_size_new_model_is_not_silently_compatible(self):
        spec=EncoderSpec('old','v1',8,8,'mean',32)
        head=FactFusionHead(spec,10,16,2)
        other=EncoderSpec('new','v1',8,8,'mean',32)
        with self.assertRaises(ValueError):head(EncodedText(torch.randn(1,8),torch.randn(1,2,8),torch.ones(1,2,dtype=torch.bool),other),torch.randn(1,2,10))

    def test_compressed_vector_is_not_fabricated_into_token_features(self):
        spec=EncoderSpec('compressed','v1',8,0,'autoencoder',32,False)
        with self.assertRaises(ValueError):FactFusionHead(spec,10)


if __name__=='__main__':unittest.main()
