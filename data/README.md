# Complaint model data

`complaint-category-dataset-v2.csv` contains 999 synthetic complaint texts, category labels, group IDs, and train/validation/test splits. Every group stays in a single split to reduce near-duplicate leakage. The trainer trims and normalizes whitespace, excludes `needs_review` rows, and learns text features through the shared unigram/bigram preprocessing in `lib/category-classifier.js`.

The source has no priority annotations. During preprocessing, priority labels are generated with `suggestPriorityFromRules`, the app's safety and service-disruption rubric. This is weak-label supervision: priority evaluation measures how well the model approximates that rubric, not how well it matches staff decisions or real-world urgency. Safety-related terms still receive a direct Critical override in the app.

Run `npm run train:model` to train both models and evaluate them on the held-out validation and test splits. The category and priority model JSON files contain accuracy, macro-F1, per-label precision/recall/F1, and confusion matrices. Replace the synthetic source with approved, de-identified, staff-confirmed complaint data before relying on its predictions operationally.
