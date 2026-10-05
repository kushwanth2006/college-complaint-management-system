# Complaint category model data

`complaint-category-dataset-v2.csv` is the supplied dataset, copied into the project so model training is reproducible. It has 999 rows, exact application category names, group IDs, and train/validation/test splits. All examples are synthetic. The current training script uses only rows where `split=train` and `label_status` is not `needs_review`; validation and test rows stay out of training.

The model is a small multinomial Naive Bayes text classifier implemented with Node's standard library. Retrain it with `npm run train:model`. The generated model is `lib/complaint-category-model.json` and is loaded by the existing category suggestion flow. Training excludes ambiguous rows, but the included `unverified` examples are still synthetic; scores are not calibrated on real campus complaints. Use this model for a project prototype, keep staff review in the workflow, and evaluate against staff-confirmed, de-identified reports before operational use.

Complaint priority remains governed by the existing safety and service-disruption rules. The dataset does not contain a dependable priority label.
