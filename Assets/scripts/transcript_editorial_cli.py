#!/usr/bin/env python3
"""Fast transcript cleaner + editorial segmenter.

This script converts word-level transcript JSON into:
1. a clean JSONL file with one word object per line
2. an editorial JSON structure with grouped phrases, line indexes, and roles

It uses deterministic heuristics so it can run in seconds instead of requiring
manual iteration in chat.
"""

from __future__ import annotations

import argparse
import itertools
import json
import re
import statistics
import sys
import time
from pathlib import Path


ARTICLES = {"el", "la", "los", "las", "lo", "un", "una", "unos", "unas", "al", "del"}
PREPS = {
    "a",
    "ante",
    "bajo",
    "cabe",
    "con",
    "contra",
    "de",
    "desde",
    "durante",
    "en",
    "entre",
    "hacia",
    "hasta",
    "mediante",
    "para",
    "por",
    "segun",
    "según",
    "sin",
    "so",
    "sobre",
    "tras",
    "versus",
    "via",
}
CONJ = {"y", "e", "ni", "o", "u", "pero", "mas", "más", "aunque", "sino", "si", "que"}
PRON = {
    "me",
    "te",
    "se",
    "nos",
    "os",
    "le",
    "les",
    "lo",
    "la",
    "los",
    "las",
    "mi",
    "mis",
    "tu",
    "tus",
    "su",
    "sus",
    "nuestro",
    "nuestra",
    "nuestros",
    "nuestras",
    "vuestro",
    "vuestra",
    "vuestros",
    "vuestras",
    "este",
    "esta",
    "estos",
    "estas",
    "ese",
    "esa",
    "esos",
    "esas",
    "aquel",
    "aquella",
    "aquellos",
    "aquellas",
    "eso",
    "esto",
    "aquello",
}
ADVS = {"no", "mas", "más"}

TERMINAL_RE = re.compile(r"""[.!?…]+["']?$""")
SOFT_RE = re.compile(r"""[,;:]+["']?$""")
STRIP_RE = re.compile(r"""^[^\wáéíóúüñ]+|[^\wáéíóúüñ]+$""", re.I)


def norm(text: str) -> str:
    return STRIP_RE.sub("", text.lower().strip())


def kind_text(text: str) -> str:
    token = norm(text)
    if token in PREPS:
        return "prep"
    if token in ARTICLES:
        return "article"
    if token in CONJ:
        return "conj"
    if token in PRON:
        return "pron"
    if token in ADVS:
        return "adv"
    return "content"


def kind(word: dict) -> str:
    return kind_text(word["text"])


def is_terminal(word: dict) -> bool:
    return bool(TERMINAL_RE.search(word["text"]))


def is_soft(word: dict) -> bool:
    return bool(SOFT_RE.search(word["text"]))


def extract_words(data: dict) -> list[dict]:
    if isinstance(data, dict) and isinstance(data.get("segments"), list):
        words: list[dict] = []
        for segment in data["segments"]:
            words.extend(segment.get("words", []))
        return words
    if isinstance(data, list):
        return data
    raise ValueError("Unsupported input JSON shape")


def gap_after(words: list[dict], index: int) -> float:
    if index >= len(words) - 1:
        return 0.0
    current = words[index]
    nxt = words[index + 1]
    return float(nxt["start"]) - (float(current["start"]) + float(current["duration"]))


def phrase_func_ratio(words: list[dict], start: int, end: int) -> float:
    block = words[start : end + 1]
    return sum(kind(word) != "content" for word in block) / len(block)


def boundary_score(words: list[dict], start: int, end: int, chunk_start: int, chunk_end: int) -> float:
    count = end - start + 1
    last = words[end]
    nxt = words[end + 1] if end + 1 < chunk_end else None
    score = 0.0

    score -= {1: 4.0, 2: 1.1, 3: 0.2, 4: 0.0, 5: 0.2, 6: 0.8, 7: 1.6, 8: 2.8}.get(count, 4 + count)

    if is_terminal(last):
        score += 4.5
    elif is_soft(last):
        score += 3.2

    gap = gap_after(words, end)
    if gap >= 0.9:
        score += 2.4
    elif gap >= 0.6:
        score += 1.8
    elif gap >= 0.45:
        score += 1.2
    elif gap >= 0.24:
        score += 0.5

    last_kind = kind(last)
    if last_kind in {"prep", "article"}:
        score -= 5.0
    elif last_kind == "conj":
        score -= 3.5
    elif last_kind == "pron":
        score -= 2.2

    if nxt is not None:
        next_kind = kind(nxt)
        if next_kind in {"prep", "article", "conj"} and last_kind == "content" and count >= 3:
            score += 1.0
        if next_kind in {"prep", "conj"} and last_kind == "content" and count == 2 and start == chunk_start and kind(words[start]) != "content":
            score += 1.8
        if next_kind == "pron" and last_kind == "content" and count >= 3:
            score += 0.3
        if words[end + 1]["text"][:1].isupper() and words[end]["text"][-1] not in ".!?":
            score += 2.0

    ratio = phrase_func_ratio(words, start, end)
    if ratio > 0.66:
        score -= 2.5

    chars = len(" ".join(word["text"] for word in words[start : end + 1]))
    if chars > 40:
        score -= 3.0
    elif chars > 32:
        score -= 1.0

    return score


def segment_words(words: list[dict], seed_counts: list[int] | None = None) -> list[tuple[int, int]]:
    segments: list[tuple[int, int]] = []
    index = 0

    if seed_counts:
        for count in seed_counts:
            if count <= 0:
                continue
            end = index + count - 1
            if end >= len(words):
                break
            segments.append((index, end))
            index += count

    chunk_start = index
    chunks: list[tuple[int, int]] = []
    for i in range(index, len(words)):
        if is_terminal(words[i]):
            chunks.append((chunk_start, i + 1))
            chunk_start = i + 1
    if chunk_start < len(words):
        chunks.append((chunk_start, len(words)))

    for chunk_start, chunk_end in chunks:
        i = chunk_start
        while i < chunk_end:
            remaining = chunk_end - i

            if remaining <= 8:
                if remaining == 1 and segments:
                    prev_start, _ = segments[-1]
                    segments[-1] = (prev_start, i)
                    i = chunk_end
                    break

                best_score = boundary_score(words, i, chunk_end - 1, chunk_start, chunk_end) + 0.5
                best_split = chunk_end - 1

                for split in range(i + 1, chunk_end - 1):
                    tail = chunk_end - (split + 1)
                    if tail == 1:
                        continue
                    if 2 <= tail <= 5:
                        score = boundary_score(words, i, split, chunk_start, chunk_end)
                        if score > best_score + 0.7:
                            best_score = score
                            best_split = split

                segments.append((i, best_split))
                i = best_split + 1
                continue

            best_split = None
            best_score = float("-inf")
            for split in range(i + 1, min(chunk_end, i + 8)):
                tail = chunk_end - (split + 1)
                if tail == 1:
                    continue
                score = boundary_score(words, i, split, chunk_start, chunk_end)
                if best_split is None or score > best_score:
                    best_score = score
                    best_split = split

            if best_split is None:
                best_split = min(chunk_end - 1, i + 3)

            segments.append((i, best_split))
            i = best_split + 1

    return segments


def line_text(group: list[dict]) -> str:
    return " ".join(word["text"] for word in group)


def line_chars(group: list[dict]) -> int:
    return len(line_text(group))


def functional_ratio(group: list[dict]) -> float:
    return sum(kind(word) != "content" for word in group) / len(group)


def break_penalty(prev_word: dict, next_word: dict) -> float:
    prev_kind = kind(prev_word)
    next_kind = kind(next_word)
    penalty = 0.0
    if prev_kind in {"prep", "article"}:
        penalty += 7.0
    elif prev_kind == "conj":
        penalty += 4.0
    elif prev_kind == "pron":
        penalty += 2.5
    if next_kind in {"prep", "article"} and prev_kind == "content":
        penalty += 0.7
    return penalty


def partition_score(block: list[dict], splits: tuple[int, ...]) -> tuple[float, list[list[dict]]]:
    groups: list[list[dict]] = []
    start = 0
    for end in splits + (len(block),):
        groups.append(block[start:end])
        start = end

    chars = [line_chars(group) for group in groups]
    score = 0.0

    for group, char_count in zip(groups, chars):
        if len(group) == 1:
            cleaned = norm(group[0]["text"])
            if len(cleaned) <= 2:
                score += 5.0
            elif len(cleaned) <= 4:
                score += 2.5
            elif len(cleaned) <= 6:
                score += 1.0

        ratio = functional_ratio(group)
        if ratio == 1:
            score += 8.0
        elif ratio > 0.66:
            score += 4.0
        elif ratio > 0.5:
            score += 1.5

        if char_count > 18:
            if len(group) == 1 or len(block) <= 2:
                score += 8.0 + (char_count - 18) * 0.5
            else:
                score += 100.0 + (char_count - 18) * 5.0
        elif char_count > 15:
            score += (char_count - 15) * 2.5

    for i in range(len(groups) - 1):
        score += break_penalty(groups[i][-1], groups[i + 1][0])

    if len(groups) >= 2 and chars[1] > chars[0]:
        score += (chars[1] - chars[0]) * 3.5

    if len(chars) > 1:
        score += statistics.pstdev(chars) * 0.25

    if len(groups) == 2 and len(block) >= 5:
        score += 2.0
    if len(groups) == 3 and len(block) >= 5:
        score -= 0.7
    if len(groups) == 2 and len(block) in {3, 4}:
        score -= 0.3

    return score, groups


def choose_lines(block: list[dict]) -> list[list[dict]]:
    count = len(block)
    if count <= 2:
        return [block]

    candidates: list[tuple[float, list[list[dict]]]] = []
    line_counts = [2] if count in {3, 4} else [3, 2]
    for total_lines in line_counts:
        if total_lines > count:
            continue
        for splits in itertools.combinations(range(1, count), total_lines - 1):
            score, groups = partition_score(block, splits)
            candidates.append((score, groups))

    candidates.sort(key=lambda item: item[0])
    return candidates[0][1]


def line_role(total_lines: int, line_index: int, words_in_phrase: int, word_index: int) -> str:
    if total_lines == 1:
        if words_in_phrase == 1:
            return "primary"
        return "primary" if word_index == 0 else "accent"
    if total_lines == 2:
        return "primary" if line_index == 0 else "accent"
    return "accent" if line_index == 1 else "primary"


def accent_line_index(total_lines: int, words_in_phrase: int) -> int | None:
    if total_lines == 1:
        return None if words_in_phrase == 1 else 0
    return 1


def build_editorial_items(words: list[dict], segments: list[tuple[int, int]], fps: float | None) -> list[dict]:
    items: list[dict] = []

    for start_index, end_index in segments:
        block = words[start_index : end_index + 1]
        lines = choose_lines(block)

        line_map: list[tuple[dict, int]] = []
        for line_index, group in enumerate(lines):
            for word in group:
                line_map.append((word, line_index))

        phrase_words = []
        for word_index, (word, line_index) in enumerate(line_map):
            phrase_words.append(
                {
                    "text": word["text"],
                    "start": word["start"],
                    "duration": word["duration"],
                    "role": line_role(len(lines), line_index, len(block), word_index),
                    "line": line_index,
                }
            )

        end = float(block[-1]["start"]) + float(block[-1]["duration"])
        if fps:
            end = round(end * fps) / fps

        items.append(
            {
                "text": " ".join(word["text"] for word in block),
                "start": block[0]["start"],
                "end": end,
                "accentLineIndex": accent_line_index(len(lines), len(block)),
                "words": phrase_words,
            }
        )

    return items


def parse_seed_counts(raw: str | None) -> list[int] | None:
    if not raw:
        return None
    counts = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        counts.append(int(item))
    return counts or None


def write_clean_jsonl(words: list[dict], output_path: Path) -> None:
    with output_path.open("w", encoding="utf-8") as handle:
        for word in words:
            handle.write(json.dumps(word, ensure_ascii=False, separators=(",", ":")))
            handle.write("\n")


def write_editorial_json(items: list[dict], output_path: Path) -> None:
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump({"items": items}, handle, ensure_ascii=False, separators=(",", ":"))


def process_file(input_path: Path, output_dir: Path, seed_counts: list[int] | None, write_clean: bool, write_editorial: bool) -> dict:
    started = time.perf_counter()

    with input_path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    words = extract_words(data)
    fps = data.get("fps") if isinstance(data, dict) else None
    segments = segment_words(words, seed_counts=seed_counts)
    items = build_editorial_items(words, segments, fps=fps)

    clean_path = output_dir / f"{input_path.stem}.clean.jsonl"
    editorial_path = output_dir / f"{input_path.stem}.editorial.json"

    if write_clean:
        write_clean_jsonl(words, clean_path)
    if write_editorial:
        write_editorial_json(items, editorial_path)

    elapsed = time.perf_counter() - started
    return {
        "input": str(input_path),
        "clean": str(clean_path) if write_clean else None,
        "editorial": str(editorial_path) if write_editorial else None,
        "words": len(words),
        "items": len(items),
        "seconds": round(elapsed, 3),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Fast cleaner + editorial segmenter for transcript JSON.")
    parser.add_argument("inputs", nargs="+", help="One or more transcript JSON files.")
    parser.add_argument("-o", "--output-dir", default=".", help="Directory where outputs will be written.")
    parser.add_argument("--seed-counts", help="Optional comma-separated phrase sizes to lock at the start of the transcript.")
    parser.add_argument("--skip-clean", action="store_true", help="Do not write the clean JSONL output.")
    parser.add_argument("--skip-editorial", action="store_true", help="Do not write the editorial JSON output.")
    return parser


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    seed_counts = parse_seed_counts(args.seed_counts)

    results = []
    for raw_input in args.inputs:
        input_path = Path(raw_input).expanduser().resolve()
        results.append(
            process_file(
                input_path=input_path,
                output_dir=output_dir,
                seed_counts=seed_counts,
                write_clean=not args.skip_clean,
                write_editorial=not args.skip_editorial,
            )
        )

    json.dump({"results": results}, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
