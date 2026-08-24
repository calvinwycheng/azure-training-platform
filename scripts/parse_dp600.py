import json
import re
from pathlib import Path

from pypdf import PdfReader


EN = Path(r"C:\Users\wyc\Downloads\DP-600_en_with_discussion.pdf")
ZH = Path(r"C:\Users\wyc\Downloads\DP-600_aizh.pdf")
OUT = Path("src/data/dp600-questions.js")


def read_pdf(path):
    reader = PdfReader(str(path))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def question_blocks(text):
    starts = list(re.finditer(r"(?:Topic\s+\d+\s*)?Question\s+#\s*(\d+)", text, re.I))
    for index, match in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(text)
        yield int(match.group(1)), text[match.end():end]


def clean(text):
    text = text.replace("\\n", "\n")
    text = re.sub(r"淘宝/闲鱼:.*?(?=\n|$)", "", text, flags=re.I)
    text = re.sub(r"微信:\s*Examt\s*opics", "", text, flags=re.I)
    text = re.sub(r"^\s*opics\s*$", "", text, flags=re.I | re.M)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def parse_options(text):
    options = []
    current = None
    for line in text.splitlines():
        line = line.strip()
        match = re.match(r"^([A-F])\.\s*(.*)$", line)
        if match:
            current = {"id": match.group(1), "en": clean(re.sub(r"\s+Most Voted\b", "", match.group(2), flags=re.I))}
            options.append(current)
        elif current and line and not re.match(r"^(Comments|Correct Answer|Community vote)", line, re.I):
            cleaned_line = clean(line)
            if cleaned_line:
                current["en"] += " " + cleaned_line
    return options


def question_only(text):
    """Keep the stem only; options and discussion are rendered separately."""
    text = clean(text)
    text = re.split(
        r"\n(?:Comments|Correct Answer|Selected Answer|Community vote|答案核验|官⽅答案|官方答案|"
        r"[^\n]*(?:题目|题⽬)(?:分析与解答|解析)|\s*1\.\s*考察的知识点)\s*[:：-]?",
        text,
        maxsplit=1,
        flags=re.I,
    )[0]
    option_start = re.search(r"(?m)^\s*[A-F]\.\s+", text)
    if option_start:
        text = text[:option_start.start()]
    text = re.sub(r"(?m)^\s*(?:Most Voted|淘宝/闲鱼:.*|opics)\s*$", "", text, flags=re.I)
    # Case-study instructions are shared boilerplate, not part of the question.
    text = re.sub(r"(?is)^.*?(?=\n(?:Overview|概述)\s*-)", "", text)
    text = re.sub(r"(?m)^\s*(?:HOTSPOT|DRAG DROP|CASE STUDY|案例研究|热点|拖放)\s*-?\s*$", "", text, flags=re.I)
    return clean(text)


def parse_analysis(text):
    marker = re.search(r"(?im)^(?:DP-600\s*考试辅导[:：]\s*)?[^\n]*(?:题目|题⽬)(?:分析与解答|解析)\s*$", clean(text))
    if not marker:
        return ""
    return clean(text)[marker.end():].strip()


def case_question_only(text, language="en"):
    lines = clean(text).splitlines()
    preferred = (r"^(?:You need|You have|You are)\b" if language == "en" else r"^(?:您需要|您有|您正在)\b")
    preferred_candidates = [index for index, line in enumerate(lines) if re.search(preferred, line, re.I)]
    if preferred_candidates:
        return clean("\n".join(lines[preferred_candidates[-1]:]))
    patterns = (r"^(?:Which|What should|How should|Select|For each)\b" if language == "en"
                else r"^(?:哪|如何|请选择|对于每个)\b")
    candidates = [index for index, line in enumerate(lines) if re.search(patterns, line, re.I)]
    if candidates:
        return clean("\n".join(lines[candidates[-1]:]))
    return clean(text)


def parse_answer(text):
    match = re.search(r"Correct Answer\s*:\s*([^\n\r]+)", text, re.I)
    if match:
        token = match.group(1).strip()
        letters = re.match(r"([A-F](?:\s*[,/]?\s*[A-F])*)\b", token, re.I)
        if letters:
            return list(dict.fromkeys(re.findall(r"[A-F]", letters.group(1).upper())))
    match = re.search(r"Selected Answer\s*:\s*([^\n\r]+)", text, re.I)
    if match:
        token = match.group(1).strip()
        letters = re.match(r"([A-F](?:\s*[,/]?\s*[A-F])*)\b", token, re.I)
        if letters:
            return list(dict.fromkeys(re.findall(r"[A-F]", letters.group(1).upper())))
    return []


def parse():
    en = dict(question_blocks(read_pdf(EN)))
    zh = dict(question_blocks(read_pdf(ZH)))
    questions = []
    for number in sorted(en):
        block = en[number]
        before_comments = re.split(r"\nComments\b", block, maxsplit=1, flags=re.I)[0]
        before_answer = re.split(r"\nCorrect Answer\s*:", before_comments, maxsplit=1, flags=re.I)[0]
        case_context_en = question_only(before_answer)
        is_case = "Case study" in block
        prompt = case_question_only(case_context_en, "en") if is_case else case_context_en
        options = parse_options(before_answer)
        answer = parse_answer(block)
        qzh = zh.get(number, "")
        analysis = parse_analysis(qzh)
        case_context_zh = question_only(qzh)
        qzh = case_question_only(case_context_zh, "zh") if is_case else case_context_zh
        zh_lines = qzh.splitlines()
        overview_zh = next((i for i, line in enumerate(zh_lines) if re.match(r"^\s*概述\s*-", line)), None)
        first_zh = overview_zh if overview_zh is not None else next((i for i, line in enumerate(zh_lines) if re.search(r"[\u3400-\u9fff]", line)), 0)
        qzh = clean("\n".join(zh_lines[first_zh:]))
        is_visual = re.search(r"\b(?:HOTSPOT|DRAG\s+DROP)\b", block, re.I)
        qtype = "visual" if is_visual else ("multiple" if len(answer) > 1 else "single")
        questions.append({
            "id": f"dp600-q-{number}", "number": number, "topic": "Topic 1", "caseId": None,
            "type": qtype, "questionEn": prompt, "questionZh": qzh,
            "interaction": "drag-drop" if re.search(r"\bDRAG\s+DROP\b", block, re.I) else ("hotspot" if re.search(r"\bHOTSPOT\b", block, re.I) else "choice"),
            "caseContextEn": case_context_en if is_case else "", "caseContextZh": case_context_zh if is_case else "",
            "options": [{"id": o["id"], "en": o["en"], "zh": ""} for o in options],
            "answer": answer, "analysis": analysis,
            "pageStart": None, "pageEnd": None, "sourceImages": [],
        })
    return questions


if __name__ == "__main__":
    questions = parse()
    payload = "window.DP600_QUESTION_BANK = " + json.dumps({"questions": questions, "cases": []}, ensure_ascii=False, separators=(",", ":")) + ";\n"
    OUT.write_text(payload, encoding="utf-8")
    print(f"wrote {len(questions)} questions; answers={sum(bool(q['answer']) for q in questions)}; options={sum(bool(q['options']) for q in questions)}")
