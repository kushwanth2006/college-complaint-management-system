import json
import math
import re
from collections import Counter
from pathlib import Path

from fastapi import FastAPI
from pydantic import BaseModel, Field


MODEL_PATH = Path(__file__).resolve().parents[1] / "lib" / "complaint-category-model.json"
MODEL = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
STOP_WORDS = set(
    "a an and are at be been but by for from has have i in is it my of on or our the this to was we with".split()
)

app = FastAPI(title="CampusDesk ML Service", version="1.0.0")


class ComplaintText(BaseModel):
    text: str = Field(min_length=1, max_length=5201)


def predict_category(text: str) -> dict:
    tokens = re.findall(r"[a-z0-9]+", re.sub(r"\bwi[\s-]+fi\b", "wifi", text.lower()))
    features = Counter()
    for token, count in Counter(tokens).items():
        if len(token) > 1 and token not in STOP_WORDS:
            features[f"u:{token}"] = count
    for left, right in zip(tokens, tokens[1:]):
        features[f"b:{left}_{right}"] += 1
    labels = MODEL["labels"]
    if not features:
        return {"category": "General" if "General" in labels else labels[0], "confidence": 35}

    vocabulary_size = len(MODEL["vocabulary"])
    scores = []
    for label in labels:
        score = math.log(MODEL["categoryCounts"][label] / MODEL["documents"])
        denominator = MODEL["featureTotals"][label] + MODEL["alpha"] * vocabulary_size
        label_features = MODEL["featureCounts"][label]
        for feature, count in features.items():
            score += count * math.log((label_features.get(feature, 0) + MODEL["alpha"]) / denominator)
        scores.append(score)

    max_score = max(scores)
    probabilities = [math.exp(score - max_score) for score in scores]
    best_index = max(range(len(labels)), key=probabilities.__getitem__)
    confidence = int(probabilities[best_index] / sum(probabilities) * 100 + 0.5)
    return {"category": labels[best_index], "confidence": confidence}


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL.get("algorithm", "loaded")}


@app.post("/predict-category")
def predict(complaint: ComplaintText):
    return predict_category(complaint.text)
