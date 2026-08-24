import json
import re
from pathlib import Path

import numpy as np
from PIL import Image


DATA = Path("src/data/dp600-questions.js")
OCR = Path("tmp/dp600-ocr-visual")


def load_bank():
    raw = DATA.read_text(encoding="utf-8")
    prefix = "window.DP600_QUESTION_BANK = "
    return json.loads(raw[len(prefix):].strip()[:-1])


def save_bank(bank):
    prefix = "window.DP600_QUESTION_BANK = "
    DATA.write_text(prefix + json.dumps(bank, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")


def center(box):
    return ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)


def red_bands(image_path):
    image = np.asarray(Image.open(image_path).convert("RGB"))
    red = (image[:, :, 0] > 135) & (image[:, :, 0] > image[:, :, 1] * 1.28) & (image[:, :, 0] > image[:, :, 2] * 1.28)
    rows = np.where(red.sum(axis=1) >= 3)[0]
    bands = []
    for row in rows:
        if not bands or row > bands[-1][-1] + 8:
            bands.append([int(row)])
        else:
            bands[-1].append(int(row))
    result = []
    for rows in bands:
        y1, y2 = rows[0], rows[-1]
        ys, xs = np.where(red[max(0, y1 - 2):y2 + 3])
        if len(xs) < 12:
            continue
        result.append((int(xs.min()), int(xs.max()), int(y1), int(y2)))
    return result


def ocr_items(path):
    payload = json.loads(path.read_text(encoding="utf-8"))
    items = []
    for text, box in zip(payload.get("rec_texts", []), payload.get("rec_boxes", [])):
        text = re.sub(r"\s+", " ", str(text)).strip()
        if not text:
            continue
        items.append({"text": text, "box": [float(v) for v in box], "center": center(box)})
    return items


def clean_text(value):
    return re.sub(r"\s+", " ", value).strip(" -:")


def extract_inputs(question):
    all_items = []
    for source in question.get("sourceImages", []):
        name = Path(source).name
        image_path = OCR / name
        result_path = OCR / f"{Path(name).stem}_res.json"
        if not image_path.exists() or not result_path.exists():
            continue
        items = ocr_items(result_path)
        answer_markers = [x["center"][1] for x in items if re.fullmatch(r"Answer Area", x["text"], re.I)]
        comments_markers = [x["center"][1] for x in items if re.fullmatch(r"Comments", x["text"], re.I)]
        answer_floor = max(answer_markers, default=0)
        comments_ceiling = min(comments_markers, default=10**9)
        for band in red_bands(image_path):
            xmin, xmax, ymin, ymax = band
            if ymin <= answer_floor or ymin >= comments_ceiling:
                continue
            selected = [x for x in items if xmin - 18 <= x["center"][0] <= xmax + 18 and ymin - 8 <= x["center"][1] <= ymax + 8]
            selected = [x for x in selected if not re.search(r"Answer Area|Correct Answer|Selected Answer|淘宝|闲鱼|opics|https?://|upvoted", x["text"], re.I)]
            if not selected:
                continue
            band_center = (ymin + ymax) / 2
            chosen = min(selected, key=lambda x: abs(x["center"][1] - band_center))
            labels = [x for x in items if x["center"][0] < xmin + 35 and ymin - 140 <= x["center"][1] < ymin - 8 and len(x["text"]) > 8 and not re.search(r"Correct Answer|Answer Area|Selected Answer", x["text"], re.I)]
            label = max(labels, key=lambda x: x["center"][1]) if labels else None
            if not label:
                label = {"text": f"Answer item {len(all_items) + 1}", "center": (xmin, ymin - 20), "box": [xmin, ymin - 30, xmax, ymin - 10]}
            next_labels = [x for x in items if x["center"][0] < xmin + 35 and x["center"][1] > ymax + 12 and len(x["text"]) > 12]
            next_y = min((x["center"][1] for x in next_labels), default=ymax + 180)
            choices = []
            for item in items:
                cx, cy = item["center"]
                if cx < xmin - 25 or cy < label["center"][1] + 12 or cy >= next_y - 4 or cy > ymax + 180:
                    continue
                if re.search(r"Answer Area|Correct Answer|Selected Answer|淘宝|闲鱼|opics|Comments|https?://|upvoted", item["text"], re.I):
                    continue
                value = clean_text(item["text"])
                if value and value not in choices:
                    choices.append(value)
            all_items.append({"label": clean_text(label["text"]), "answer": clean_text(chosen["text"]), "choices": choices})
    # Preserve reading order and remove duplicate detections across adjacent pages.
    unique = []
    seen = set()
    for item in all_items:
        key = (item["label"], item["answer"])
        if key not in seen:
            unique.append(item)
            seen.add(key)
    return unique


def analysis_answers(question):
    text = question.get("analysis", "")
    match = re.search(r"(?:我的答案|我选的答案)\s*[:：]?(.+?)(?=\n\s*(?:4\.|官⽅答案|官方答案)|$)", text, re.S)
    if not match:
        return []
    values = []
    for raw in match.group(1).splitlines():
        line = re.sub(r"^\s*\d+[.、]\s*", "", clean_text(raw))
        if not line or len(line) > 180 or re.search(r"分析|正确|错误|原因|比较|一致|答案为", line):
            continue
        if "->" in line:
            label, answer = line.split("->", 1)
        elif ":" in line:
            label, answer = line.split(":", 1)
        else:
            label, answer = f"Answer item {len(values) + 1}", line
        answer = clean_text(answer)
        if answer and answer not in {"Correct Answer", "正确答案"}:
            values.append((clean_text(label) or f"Answer item {len(values) + 1}", answer))
    return values[:8]


def main():
    bank = load_bank()
    found = 0
    for question in bank["questions"]:
        if question["type"] != "visual":
            continue
        question.pop("visualInputs", None)
        inputs = extract_inputs(question)
        if not inputs:
            inferred = analysis_answers(question)
            inputs = [{"label": label, "answer": answer, "choices": []} for label, answer in inferred]
        if not inputs:
            continue
        question["visualInputs"] = [{"id": f"item{index}", **item} for index, item in enumerate(inputs, 1)]
        question["answer"] = [f"item{index}:{item['answer']}" for index, item in enumerate(inputs, 1)]
        found += 1

    # A few OCR layouts merge adjacent dropdowns; use the visible answer-area
    # labels and the discussion's verified selections to restore their groups.
    manual = {
        97: [
            ('HighestSellingPrice function', 'GREATEST', ['COALESCE', 'GREATEST', 'IIF', 'MAX']),
            ('TradePrice function', 'COALESCE', ['CHOOSE', 'COALESCE', 'IIF', 'MAX']),
        ],
        90: [
            ('Calculation item function', 'CALCULATE', ['CALCULATE', 'GENERATE', 'MEASURE', 'COMBINEVALUES']),
            ('Selected measure function', 'SELECTEDMEASURE', ['SELECTEDMEASURE', 'SELECTEDVALUE', 'DATESMTD']),
        ],
        82: [
            ('Create table statement', 'CREATE TABLE dbo.POSCustomers AS SELECT', ['CREATE TABLE dbo.POSCustomers', 'CREATE TABLE dbo.POSCustomers AS CLONE OF', 'CREATE TABLE dbo.POSCustomers AS SELECT']),
            ('Source table', 'FROM lakehouse1.dbo.customer', ['FROM dbo.Customer', 'FROM dbo.POSCustomers', 'FROM lakehouse1.dbo.customer']),
        ],
        110: [
            ('File format', 'csv', ['csv', 'delta', 'parquet']),
            ('Storage path', 'labs/productline2', ['labs/productline2', 'Tables/productline2', 'files/productline2']),
        ],
        174: [
            ('Item name conversion', 'try_cast(item_name as varchar(20))', ['convert(varchar(20), item_name)', 'convert(varchar(max), item_name)', 'try_cast(item_name as varchar(20))']),
            ('Purchase date conversion', 'convert(varchar, purchase_date, 7)', ['convert(varchar, purchase_date, 7)', 'convert(varchar, purchase_date, 109)', 'convert(varchar, purchase_date, 112)']),
        ],
        177: [
            ('JOIN type', 'LEFT OUTER JOIN', ['CROSS JOIN', 'INNER JOIN', 'LEFT OUTER JOIN', 'RIGHT OUTER JOIN']),
            ('Filter condition', 'HAVING', ['WHERE', 'GROUP BY', 'HAVING']),
        ],
        178: [
            ('First KQL operator', 'extend', ['evaluate', 'extend', 'lookup', 'project', 'summarize']),
            ('Second KQL operator', 'project', ['evaluate', 'extend', 'lookup', 'project', 'summarize']),
        ],
        179: [
            ('Year expression', 'YEAR', ['CAST', 'CONVERT', 'YEAR']),
            ('Grouping expression', 'ROLLUP(YEAR(SO.ModifiedDate), P.Name)', ['CUBE(YEAR(SO.ModifiedDate), P.Name)', 'GROUPING SETS (YEAR(SO.ModifiedDate), P.Name)', 'ROLLUP(YEAR(SO.ModifiedDate), P.Name)']),
        ],
        183: [
            ('Formatting feature', 'dynamic format string', ['calculation group', 'data category', 'dynamic format string', 'synonym']),
            ('Value format', 'percentages or whole numbers', ['percentages only', 'percentages or decimals', 'whole numbers only', 'percentages or whole numbers']),
        ],
        191: [
            ('Top rows syntax', 'Top (3)', ['FETCH NEXT 3 ROWS ONLY', 'Limit (3)', 'Top (3)']),
            ('Group expression', 'GROUP BY company', ['GROUP BY TaxiCompany', 'GROUP BY company']),
            ('Order expression', 'ORDER BY sum(tripDistance)', ['ORDER BY tripDistance', 'ORDER BY sum(tripDistance)']),
        ],
        74: [
            ('DataFrame write mode', '("append")', ['("append")', '("error")', '("errorifexists")', '("ignore")', '("overwrite")']),
            ('mergeSchema option', '("mergeSchema","true")', ['("mergeSchema","false")', '("mergeSchema","true")', '("overwriteSchema","false")', '("overwriteSchema","true")']),
        ],
        99: [
            ("PeriodDate function", "DATETRUNC", ["DATE_BUCKET", "DATEFROMPARTS", "DATEPART", "DATETRUNC"]),
            ("DayName date part", "weekday", ["day", "dayofyear", "weekday"]),
        ],
        12: [
            ("The code embeds an existing Power BI report", "No", ["Yes", "No"]),
            ("The code creates a Power BI report", "Yes", ["Yes", "No"]),
            ("The code displays a summary of the DataFrame", "No", ["Yes", "No"]),
        ],
        112: [
            ("The Spark engine will read only the selected columns", "No", ["Yes", "No"]),
            ("The Year column replaces the OrderDate column in the table", "No", ["Yes", "No"]),
            ("Adding inferSchema='true' to the options will increase the execution time of the query", "Yes", ["Yes", "No"]),
        ],
        123: [
            ("A replica of dbo.FactSales is created in the test schema by copying the metadata only", "Yes", ["Yes", "No"]),
            ("Additional schema changes to dbo.FactSales will also apply to test.FactSales", "No", ["Yes", "No"]),
            ("Additional data changes to dbo.FactSales will also apply to test.FactSales", "No", ["Yes", "No"]),
        ],
        131: [
            ("customers is a pandas DataFrame", "No", ["Yes", "No"]),
            ("If a delta table named Customers does NOT exist, an error will be generated", "Yes", ["Yes", "No"]),
            ("The source data is located in the customers folder in a container named contacts", "Yes", ["Yes", "No"]),
        ],
        140: [
            ("definition.pbir is in the PBIR-Legacy format", "No", ["Yes", "No"]),
            ("The semantic model referenced by definition.pbir is located in the Power BI service", "Yes", ["Yes", "No"]),
            ("When the related report is opened, Power BI Desktop will open the semantic model in full edit mode", "No", ["Yes", "No"]),
        ],
        146: [
            ("The query excludes sales that have a Status of Cancelled", "Yes", ["Yes", "No"]),
            ("The query calculates the total sales of each product category for the last 30 days", "Yes", ["Yes", "No"]),
            ("The query includes product categories that have had zero sales during the last 30 days", "No", ["Yes", "No"]),
        ],
        211: [
            ("Measure1 will return an error if there are no sales for all products", "No", ["Yes", "No"]),
            ("Measure1 will return a decimal value that represents the ratio of the current product's total sales to the total sales across all products", "Yes", ["Yes", "No"]),
            ("The denominator of Measure1 will be calculated by using the modified filter context created by REMOVEFILTERS", "Yes", ["Yes", "No"]),
        ],
        71: [
            ("df", "withColumn", ["cast", "col", "get", "select", "selectExpr", "transform", "withColumn"]),
            ('first function', "col", ["cast", "col", "get", "select", "selectExpr", "transform", "withColumn"]),
            ('second function', "cast", ["cast", "col", "get", "select", "selectExpr", "transform", "withColumn"]),
        ],
        70: [
            ("Orchestration pipeline", "A schedule", ["A schedule", "A pipeline Copy activity", "A pipeline Dataflow activity", "A pipeline Stored procedure activity", "A Spark job definition", "An Invoke pipeline activity"]),
            ("Bronze layer", "A pipeline Copy activity", ["A schedule", "A pipeline Copy activity", "A pipeline Dataflow activity", "A pipeline Stored procedure activity", "A Spark job definition", "An Invoke pipeline activity"]),
            ("Silver layer", "A pipeline Dataflow activity", ["A schedule", "A pipeline Copy activity", "A pipeline Dataflow activity", "A pipeline Stored procedure activity", "A Spark job definition", "An Invoke pipeline activity"]),
            ("Gold layer", "A pipeline Stored procedure activity", ["A schedule", "A pipeline Copy activity", "A pipeline Dataflow activity", "A pipeline Stored procedure activity", "A Spark job definition", "An Invoke pipeline activity"]),
        ],
        34: [
            ("Of the transformation steps in the query will fold", "Some", ["All", "None", "Some"]),
            ("The Added custom step will be performed in", "the Microsoft Power Query engine", ["each lakehouse's query engine", "the Microsoft Power Query engine", "the source lakehouse query engine"]),
        ],
        41: [
            ("The results will form a hierarchy of folders for each partition key", "Yes", ["Yes", "No"]),
            ("The resulting file partitions can be read in parallel across multiple nodes", "Yes", ["Yes", "No"]),
            ("The resulting file partitions will use file compression", "Yes", ["Yes", "No"]),
        ],
        45: [
            ("The Spark engine will read only the selected columns", "No", ["Yes", "No"]),
            ("Removing the partition will reduce the execution time", "No", ["Yes", "No"]),
            ("Adding inferSchema='true' will increase execution time", "Yes", ["Yes", "No"]),
        ],
        53: [
            ("DataFrame transformation", "df.withColumn", ["df.columns", "df.select", "df.withColumn", "df.withColumnsRenamed"]),
            ("Date conversion", ".cast('date')", [".alias('date')", ".cast('date')", ".cast('pickupDate')", ".getfield('date')"]),
            ("Filter expression", 'filter("fareAmount > 0 AND fareAmount < 100")', ['filter("fareAmount > 0 AND fareAmount < 100")', '.filter(col("fareAmount").contains("1..100"))', '.when(df.fareAmount > 0 AND fareAmount < 100)', '.where(df.fareAmount.isin([1,100]))']),
        ],
        72: [("File format", "delta", ["delta", "parquet", "csv", "json"]), ("Table name", "sales", ["sales", "files/sales", "tables/sales"])],
        75: [("ChargedQuantity", "COALESCE", ["COALESCE", "LEAST"]), ("OrderPrice", "LEAST", ["COALESCE", "LEAST"])],
        102: [("Last-year calculation", "CALCULATE", ["CALCULATE", "CALCULATETABLE", "FILTER"]), ("Return value", "_LYSales", ["_LYSales", "[Total Sales]", "VAR", "RETURN"])],
        50: [("Connection", "https", ["abfs", "abfss", "https"]), ("Endpoint", "dfs", ["blob", "dfs", "file"])],
        52: [("The Direct Lake fallback behavior is set to", "Automatic", ["Automatic", "DirectLakeOnly", "DirectQueryOnly"]), ("The query for the table visual is executed by using", "Direct Lake", ["the composite model", "Direct Lake", "Direct Query"])],
        220: [("DataFrame transformation", "withColumn", ["transform", "withColumn", "withColumnRenamed", "withMetadata"]), ("Year expression", "col", ["col", "extract", "lit", "InvoiceDateKey"])],
    }
    for number, values in manual.items():
        question = next((q for q in bank["questions"] if q["number"] == number), None)
        if not question:
            continue
        question["visualInputs"] = [{"id": f"item{i}", "label": label, "answer": answer, "choices": choices} for i, (label, answer, choices) in enumerate(values, 1)]
        question["answer"] = [f"item{i}:{answer}" for i, (_, answer, _) in enumerate(values, 1)]
    # Keep every drag/drop question interactive even when the PDF layout has no
    # separable OCR candidate boxes: the verified answers remain draggable.
    for question in bank["questions"]:
        if question.get("interaction") == "drag-drop" and question.get("visualInputs"):
            fallback = list(dict.fromkeys(item["answer"] for item in question["visualInputs"] if item.get("answer")))
            for item in question["visualInputs"]:
                if not item.get("choices"):
                    item["choices"] = fallback
    save_bank(bank)
    print(f"visual inputs populated for {sum(bool(q.get('visualInputs')) for q in bank['questions'])} questions")


if __name__ == "__main__":
    main()
