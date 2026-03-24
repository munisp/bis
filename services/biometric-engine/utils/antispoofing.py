"""
Anti-spoofing predictor wrapper.
Wraps the Silent-Face-Anti-Spoofing binary classifier.
Falls back to texture analysis if the model weights are not present.

Model: MiniFASNetV2 (2.7 MB) from:
  https://github.com/minivision-ai/Silent-Face-Anti-Spoofing

Download weights to: utils/weights/2.7_80x80_MiniFASNetV2.pth
"""

import os
import logging
import numpy as np

log = logging.getLogger("biometric-engine.antispoofing")

WEIGHTS_PATH = os.path.join(os.path.dirname(__file__), "weights", "2.7_80x80_MiniFASNetV2.pth")


class AntiSpoofPredictor:
    """
    Wrapper around MiniFASNetV2 anti-spoofing model.
    If model weights are not present, raises ImportError so the caller
    falls back to texture analysis.
    """

    def __init__(self):
        if not os.path.exists(WEIGHTS_PATH):
            raise ImportError(
                f"Anti-spoofing model weights not found at {WEIGHTS_PATH}. "
                "Download from https://github.com/minivision-ai/Silent-Face-Anti-Spoofing "
                "and place in services/biometric-engine/utils/weights/"
            )

        try:
            import torch
            import torch.nn as nn
            from torchvision import transforms

            # Load MiniFASNetV2 architecture
            from utils.minifasnet import MiniFASNetV2
            self.model = MiniFASNetV2(conv6_kernel=(5, 5))
            state = torch.load(WEIGHTS_PATH, map_location="cpu")
            self.model.load_state_dict(state)
            self.model.eval()

            self.transform = transforms.Compose([
                transforms.ToPILImage(),
                transforms.Resize((80, 80)),
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5]),
            ])
            self._torch = torch
            log.info("MiniFASNetV2 anti-spoofing model loaded")
        except Exception as e:
            raise ImportError(f"Failed to load MiniFASNetV2: {e}")

    def predict(self, img_bgr: np.ndarray) -> dict:
        """
        Predict genuine/spoof for a face image.
        Returns: {"genuine_score": float, "spoof_score": float}
        """
        import cv2
        rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        tensor = self.transform(rgb).unsqueeze(0)

        with self._torch.no_grad():
            output = self.model(tensor)
            probs = self._torch.softmax(output, dim=1).squeeze().numpy()

        # Class 0 = spoof, Class 1 = genuine (MiniFASNetV2 convention)
        genuine_score = float(probs[1]) if len(probs) > 1 else float(probs[0])
        return {
            "genuine_score": genuine_score,
            "spoof_score": 1.0 - genuine_score,
        }
