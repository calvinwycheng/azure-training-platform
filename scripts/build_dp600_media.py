import json
import re
from pathlib import Path

from PIL import Image
import pypdfium2 as pdfium
from pypdf import PdfReader


PDF = Path(r"C:\Users\wyc\Downloads\DP-600_en_with_discussion.pdf")
DATA = Path("src/data/dp600-questions.js")
ASSET_ROOT = Path("src/assets/dp600/pages")
EXHIBIT_ROOT = Path("src/assets/dp600/exhibits")
OCR_ROOT = Path("tmp/dp600-ocr-pages")
VISUAL_OCR_ROOT = Path("tmp/dp600-ocr-visual")


def load_bank():
    raw = DATA.read_text(encoding="utf-8")
    prefix = "window.DP600_QUESTION_BANK = "
    return json.loads(raw[len(prefix):].strip()[:-1])


def save_bank(bank):
    payload = "window.DP600_QUESTION_BANK = " + json.dumps(bank, ensure_ascii=False, separators=(",", ":")) + ";\n"
    DATA.write_text(payload, encoding="utf-8")


def page_map(reader):
    texts = [(page.extract_text() or "").replace("\\n", "\n") for page in reader.pages]
    result = {}
    for number in range(1, 223):
        needle = f"Question #{number}"
        for index, text in enumerate(texts):
            if needle in text:
                result[number] = index + 1
                break
    return texts, result


def render_page(document, page_number):
    ASSET_ROOT.mkdir(parents=True, exist_ok=True)
    OCR_ROOT.mkdir(parents=True, exist_ok=True)
    name = f"page-{page_number:04d}.jpg"
    target = ASSET_ROOT / name
    ocr_target = OCR_ROOT / name
    if not target.exists():
        image = document[page_number - 1].render(scale=1.7).to_pil().convert("RGB")
        image.save(target, quality=82, optimize=True)
    if not ocr_target.exists():
        ocr_target.write_bytes(target.read_bytes())
    return f"assets/dp600/pages/{name}"


def extract_page_images(page, page_number):
    """Extract embedded exhibit images so visual questions show the actual graphic."""
    EXHIBIT_ROOT.mkdir(parents=True, exist_ok=True)
    sources = []
    for image in page.images:
        suffix = Path(image.name).suffix.lower() or ".png"
        filename = f"page-{page_number:04d}-{Path(image.name).stem}{suffix}"
        target = EXHIBIT_ROOT / filename
        if not target.exists():
            target.write_bytes(image.data)
        sources.append(f"assets/dp600/exhibits/{filename}")
    return sources


def ocr_page_has_answer_area(page_number):
    result = VISUAL_OCR_ROOT / f"page-{page_number:04d}_res.json"
    if not result.exists():
        return False
    try:
        payload = json.loads(result.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return any(re.fullmatch(r"Answer Area", str(text).strip(), re.I) for text in payload.get("rec_texts", []))


def main():
    bank = load_bank()
    bank["cases"] = []
    reader = PdfReader(str(PDF))
    texts, starts = page_map(reader)
    document = pdfium.PdfDocument(str(PDF))
    ordered = sorted((q["number"], starts.get(q["number"])) for q in bank["questions"] if starts.get(q["number"]))
    next_start = {number: (ordered[i + 1][1] if i + 1 < len(ordered) else len(texts) + 1) for i, (number, _) in enumerate(ordered)}

    for question in bank["questions"]:
        start = starts.get(question["number"])
        if not start:
            continue
        end = max(start, next_start[question["number"]] - 1)
        # A question image is the stem/answer area, not an unbounded discussion section.
        if question["type"] == "visual":
            end = min(end, start + 2)
        else:
            end = min(end, start + 1)
        is_case = "Case study" in texts[start - 1]
        pages = [render_page(document, page) for page in range(start, end + 1)] if question["type"] == "visual" or is_case else []
        exhibits = []
        page_text = "\n".join(texts[start - 1:end])
        if question["type"] == "visual" and not re.search(r"Answer Area", page_text, re.I):
            for page_number in range(start, end + 1):
                if not ocr_page_has_answer_area(page_number):
                    exhibits.extend(extract_page_images(reader.pages[page_number - 1], page_number))
        if question.get("interaction") == "drag-drop":
            # Drag/drop pages commonly contain the question exhibit, Answer Area, and marked answer.
            exhibits = exhibits[:1]
        question["pageStart"] = start
        question["pageEnd"] = end
        question["exhibitImages"] = exhibits
        question["sourceImages"] = pages

    # Group contiguous case-study questions and expose the first case context separately.
    case_questions = [q for q in bank["questions"] if "Case study" in texts[starts.get(q["number"], 1) - 1]]
    if case_questions:
        groups = []
        current = []
        for question in case_questions:
            if current and question["number"] != current[-1]["number"] + 1:
                groups.append(current)
                current = []
            current.append(question)
        if current:
            groups.append(current)
        for index, group in enumerate(groups, 1):
            first = group[0]
            case_id = f"dp600-case-{index}"
            for question in group:
                question["caseId"] = case_id
            description_en = first.get("caseContextEn") or first["questionEn"]
            description_zh = first.get("caseContextZh") or first["questionZh"]
            bank.setdefault("cases", []).append({
                "id": case_id,
                "title": f"DP-600 Case Study {index}",
                "titleZh": f"DP-600 案例 {index}",
                "descriptionEn": description_en,
                "descriptionZh": description_zh,
                "questionIds": [q["id"] for q in group],
                "sourceImages": sorted({source for question in group for source in question.get("sourceImages", [])}),
            })
    save_bank(bank)
    visual_pages = sorted({p for q in bank["questions"] if q["type"] == "visual" for p in range(q["pageStart"], q["pageEnd"] + 1)})
    print(f"questions={len(bank['questions'])} cases={len(bank.get('cases', []))} visualPages={len(visual_pages)} assets={ASSET_ROOT}")


if __name__ == "__main__":
    main()
