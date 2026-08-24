from pathlib import Path

import pypdfium2 as pdfium


PDF = Path(r"C:\Users\wyc\Downloads\DP-600_aizh.pdf")
OUT = Path("tmp/dp600-ocr-all-zh")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(str(PDF))
    for index in range(len(document)):
        target = OUT / f"page-{index + 1:04d}.jpg"
        if target.exists():
            continue
        image = document[index].render(scale=1.7).to_pil().convert("RGB")
        image.save(target, quality=82, optimize=True)
    print(f"rendered {len(document)} pages to {OUT}")


if __name__ == "__main__":
    main()
