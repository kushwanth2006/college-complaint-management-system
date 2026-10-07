# Severity dataset splits

Prepared from the supplied `train.csv` and `test.csv`, plus rows in `university_students_complaints.xlsx` that were absent from both files. The original supplied rows and labels are copied unchanged. No complaint examples or severity labels were synthesized.

| Split | Rows | Complaint groups |
|---|---:|---:|
| Train | 273 | 153 |
| Validation | 64 | 33 |
| Test | 59 | 33 |
| Total | 396 | 219 |

All three splits are group-disjoint. Validation contains the 64 source rows missing from the supplied train/test files (33 groups).

## Review note

The source has severity disagreement within complaint group(s): 198. Labels were preserved as supplied; review these cases before relying on group-level summaries.

Train and test are byte-for-byte copies of the supplied CSV files. `validation.csv` uses the same columns and order, with values read from the workbook's `Complaints_Clean` sheet.
