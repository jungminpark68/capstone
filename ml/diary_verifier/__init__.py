"""Trainable, fact-conditioned visual verifier. No remote inference in this package."""

LABELS = ("supported", "contradicted", "uncertain")
LABEL_TOKENS = ("A", "B", "C")
BASE_MODEL = None  # Model selection is pending; callers must choose a checkpoint explicitly.
