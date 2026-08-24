import json
from pathlib import Path

from pypdf import PdfReader


PDF = Path(r"C:\Users\wyc\Downloads\DP-600_aizh.pdf")
OUT = Path("src/assets/dp600/exhibits")
DATA = Path("src/data/dp600-questions.js")


def main():
    reader = PdfReader(str(PDF))
    OUT.mkdir(parents=True, exist_ok=True)
    # Question 117 occupies Chinese PDF page 244; extract embedded query/exhibit images.
    page_number = 244
    sources = []
    for image in reader.pages[page_number - 1].images:
        suffix = Path(image.name).suffix.lower() or ".png"
        filename = f"zh-page-{page_number:04d}-{Path(image.name).stem}{suffix}"
        target = OUT / filename
        target.write_bytes(image.data)
        sources.append(f"assets/dp600/exhibits/{filename}")

    raw = DATA.read_text(encoding="utf-8")
    prefix = "window.DP600_QUESTION_BANK = "
    bank = json.loads(raw[len(prefix):].strip()[:-1])
    question = next(q for q in bank["questions"] if q["number"] == 117)
    question["exhibitImages"] = sources[:1]
    question["inputMode"] = "choice"
    question["visualInputs"] = [
        {"id": "item1", "label": "Dimension.GetDirectReports is a scalar T-SQL function", "answer": "Yes", "choices": ["Yes", "No"]},
        {"id": "item2", "label": "The Dimension.GetDirectReports function will run only once when the query runs", "answer": "No", "choices": ["Yes", "No"]},
        {"id": "item3", "label": "The output rows will include at least one row for each row in the Dimension.Employee table", "answer": "Yes", "choices": ["Yes", "No"]},
    ]
    question["answer"] = [f"item{i}:{item['answer']}" for i, item in enumerate(question["visualInputs"], 1)]
    DATA.write_text(prefix + json.dumps(bank, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"extracted {len(sources)} Chinese exhibit images for question 117")


if __name__ == "__main__":
    main()
