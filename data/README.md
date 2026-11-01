# Complaint model data

`complaint-category-dataset-v2.csv` contains 999 synthetic complaint texts, category labels, group IDs, and train/validation/test splits. Every group stays in a single split to reduce near-duplicate leakage. The trainer trims and normalizes whitespace, excludes `needs_review` rows, and learns text features through the shared unigram/bigram preprocessing in `lib/category-classifier.js`.

The source has no priority annotations. During preprocessing, priority labels are generated with `suggestPriorityFromRules`, the app's safety and service-disruption rubric. This is weak-label supervision: priority evaluation measures how well the model approximates that rubric, not how well it matches staff decisions or real-world urgency. Safety-related terms still receive a direct Critical override in the app.

Run `npm run train:model` to train both models and evaluate them on the held-out validation and test splits. The category and priority model JSON files contain accuracy, macro-F1, per-label precision/recall/F1, and confusion matrices. Replace the synthetic source with approved, de-identified, staff-confirmed complaint data before relying on its predictions operationally.

## Importing a labeled CSV

The trainer also accepts a CSV path whose columns are `complaint_id`, `department`, `complaint_text`, and `severity`:

```powershell
npm run train:model -- "C:\path\to\college_complaints_3000.csv"
```

It maps `Academics` to `Academic` and `Wifi and internet` to `Wi-Fi & Network`; the other department labels must match the model labels. Severity must be `Low`, `Medium`, `High`, or `Critical`. For this input format, a deterministic holdout split keeps rows with the same first five normalized complaint tokens together, to reduce repeated-opening-template leakage. Validation coverage is checked by department and severity. This grouping does not detect every paraphrase or shared template.

The supplied 3,000-row CSV used for the current model artifacts had evenly balanced severity labels and formulaic recurring wording. Its source and annotation provenance were not included. The resulting 100% held-out accuracy and macro-F1 should therefore be treated as a property of this dataset, not as evidence of real-campus performance. Keep raw complaint data out of Git; `.gitignore` excludes CSV files under `data/`.
