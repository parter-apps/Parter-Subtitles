#!/usr/bin/env python3

from __future__ import annotations

import argparse
import base64
import copy
import gzip
import json
import math
import re
import struct
import uuid
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path


TICKS_PER_SECOND = 254_016_000_000


@dataclass
class WordUnit:
    phrase_index: int
    word_index: int
    word_count: int
    phrase_text: str
    text: str
    start_seconds: float
    end_seconds: float
    visible_duration_seconds: float
    x: float
    y: float
    width: float
    height: float
    fill: str
    opacity: float
    font_family: str
    font_size: float
    font_weight: float
    rotation: float


def safe_str(value) -> str:
    if value is None:
        return ""
    return str(value)


def snap_seconds_to_frame_floor(seconds: float, fps: float) -> float:
    if math.isnan(seconds) or fps <= 0:
        return seconds
    frames = math.floor((seconds * fps) + 0.000001)
    return frames / fps


def parse_layout_json(path: Path, fps: float) -> list[dict]:
    data = json.loads(path.read_text())
    result: list[dict] = []

    if data.get("items"):
        for idx, layout in enumerate(data["items"]):
            start_seconds = float(layout.get("start", "nan"))
            end_seconds = float(layout.get("end", "nan"))
            if math.isnan(start_seconds) or math.isnan(end_seconds) or end_seconds <= start_seconds:
                continue

            elements = []
            for el in layout.get("words") or []:
                text = safe_str(el.get("text")).strip()
                if not text:
                    continue

                word_start = float(el.get("start", start_seconds))
                if math.isnan(word_start):
                    word_start = start_seconds

                duration = float(el.get("duration", 0))
                if math.isnan(duration) or duration < 0:
                    duration = 0.0

                elements.append(
                    {
                        "text": text,
                        "x": float(el.get("x", 0)),
                        "y": float(el.get("y", 0)),
                        "width": float(el.get("width", 0)),
                        "height": float(el.get("height", 0)),
                        "fill": safe_str(el.get("fill")),
                        "opacity": float(el.get("opacity", 0)),
                        "fontFamily": safe_str(el.get("fontFamily")),
                        "fontSize": float(el.get("fontSize", 0)),
                        "fontWeight": float(el.get("fontWeight", 0)),
                        "rotation": float(el.get("rotation", 0)),
                        "startSeconds": word_start,
                        "durationSeconds": duration,
                        "line": float(el.get("line", 0)),
                        "role": safe_str(el.get("role")),
                    }
                )

            if elements:
                result.append(
                    {
                        "phrase": safe_str(layout.get("text")),
                        "background": "",
                        "startTC": "",
                        "endTC": "",
                        "startSeconds": start_seconds,
                        "endSeconds": end_seconds,
                        "elements": elements,
                    }
                )
        return result

    if data.get("layouts"):
        for layout in data["layouts"]:
            phrase = safe_str(layout.get("phrase"))
            timecode = safe_str(layout.get("timecode"))
            match = re.match(r"^(\d{2}):(\d{2}):(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2}):(\d{2}):(\d{2})$", timecode)
            if not match:
                continue

            def tc_to_seconds(values: tuple[str, str, str, str]) -> float:
                hh, mm, ss, ff = (int(v) for v in values)
                return (hh * 3600) + (mm * 60) + ss + (ff / fps)

            start_seconds = tc_to_seconds(match.groups()[0:4])
            end_seconds = tc_to_seconds(match.groups()[4:8])

            elements = []
            for el in layout.get("elements") or []:
                text = safe_str(el.get("text")).strip()
                if not text:
                    continue
                elements.append(
                    {
                        "text": text,
                        "x": float(el.get("x", 0)),
                        "y": float(el.get("y", 0)),
                        "width": float(el.get("width", 0)),
                        "height": float(el.get("height", 0)),
                        "fill": safe_str(el.get("fill")),
                        "opacity": float(el.get("opacity", 0)),
                        "fontFamily": safe_str(el.get("fontFamily")),
                        "fontSize": float(el.get("fontSize", 0)),
                        "fontWeight": float(el.get("fontWeight", 0)),
                        "rotation": float(el.get("rotation", 0)),
                    }
                )

            if elements:
                result.append(
                    {
                        "phrase": phrase,
                        "background": safe_str(layout.get("background")),
                        "startTC": timecode.split("-")[0].strip(),
                        "endTC": timecode.split("-")[1].strip(),
                        "startSeconds": start_seconds,
                        "endSeconds": end_seconds,
                        "elements": elements,
                    }
                )

    return result


def get_layout_effective_end_seconds(items: list[dict], layout_index: int, fps: float) -> float:
    layout = items[layout_index]
    end_sec = float(layout["endSeconds"])
    if layout_index + 1 < len(items):
        next_start = float(items[layout_index + 1]["startSeconds"])
        snapped = snap_seconds_to_frame_floor(next_start, fps)
        if math.isnan(end_sec) or snapped > end_sec:
            end_sec = snapped
    return end_sec


def build_word_units(items: list[dict], fps: float) -> list[WordUnit]:
    out: list[WordUnit] = []
    for phrase_index, layout in enumerate(items):
        elements = layout.get("elements") or []
        if not elements:
            continue

        total_dur = float(layout["endSeconds"]) - float(layout["startSeconds"])
        if total_dur <= 0:
            total_dur = len(elements) * 0.2

        each_dur = total_dur / len(elements)
        effective_end = get_layout_effective_end_seconds(items, phrase_index, fps)
        if math.isnan(effective_end) or effective_end <= float(layout["startSeconds"]):
            effective_end = float(layout["endSeconds"])

        for word_index, el in enumerate(elements):
            start_sec = float(el.get("startSeconds", float(layout["startSeconds"]) + (word_index * each_dur)))
            if math.isnan(start_sec):
                start_sec = float(layout["startSeconds"]) + (word_index * each_dur)

            visible_dur = effective_end - start_sec
            if visible_dur <= 0:
                visible_dur = float(el.get("durationSeconds", 0))
            if math.isnan(visible_dur) or visible_dur <= 0:
                visible_dur = each_dur

            end_sec = effective_end
            if math.isnan(end_sec) or end_sec <= start_sec:
                end_sec = start_sec + visible_dur

            out.append(
                WordUnit(
                    phrase_index=phrase_index,
                    word_index=word_index,
                    word_count=len(elements),
                    phrase_text=safe_str(layout.get("phrase")),
                    text=safe_str(el.get("text")),
                    start_seconds=start_sec,
                    end_seconds=end_sec,
                    visible_duration_seconds=visible_dur,
                    x=float(el.get("x", 0)),
                    y=float(el.get("y", 0)),
                    width=float(el.get("width", 0)),
                    height=float(el.get("height", 0)),
                    fill=safe_str(el.get("fill")),
                    opacity=float(el.get("opacity", 0)),
                    font_family=safe_str(el.get("fontFamily")),
                    font_size=float(el.get("fontSize", 0)),
                    font_weight=float(el.get("fontWeight", 0)),
                    rotation=float(el.get("rotation", 0)),
                )
            )

    return out


def deep_copy(elem: ET.Element) -> ET.Element:
    return copy.deepcopy(elem)


def get_object_id(elem: ET.Element) -> int:
    return int(elem.attrib["ObjectID"])


def get_object_uid(elem: ET.Element) -> str:
    return elem.attrib["ObjectUID"]


def index_objects(root: ET.Element) -> tuple[dict[int, ET.Element], dict[str, ET.Element]]:
    by_id: dict[int, ET.Element] = {}
    by_uid: dict[str, ET.Element] = {}
    for child in root:
        object_id = child.attrib.get("ObjectID")
        if object_id:
            by_id[int(object_id)] = child
        object_uid = child.attrib.get("ObjectUID")
        if object_uid:
            by_uid[object_uid] = child
    return by_id, by_uid


def append_object(root: ET.Element, by_id: dict[int, ET.Element], by_uid: dict[str, ET.Element], elem: ET.Element) -> None:
    root.append(elem)
    object_id = elem.attrib.get("ObjectID")
    if object_id:
        by_id[int(object_id)] = elem
    object_uid = elem.attrib.get("ObjectUID")
    if object_uid:
        by_uid[object_uid] = elem


def find_sequence_by_name(root: ET.Element, sequence_name: str) -> ET.Element:
    for child in root:
        if child.tag != "Sequence":
            continue
        name = child.findtext("Name")
        if name == sequence_name:
            return child
    raise ValueError(f"No se encontró la secuencia '{sequence_name}'.")


def get_sequence_track_group_refs(sequence: ET.Element) -> tuple[int, int, int]:
    refs = []
    for track_group in sequence.findall("./TrackGroups/TrackGroup"):
        second = track_group.find("Second")
        if second is not None:
            refs.append(int(second.attrib["ObjectRef"]))
    if len(refs) < 3:
        raise ValueError("La secuencia no tiene los 3 TrackGroups esperados.")
    return refs[0], refs[1], refs[2]


def get_frame_rate_from_video_group(video_group: ET.Element) -> float:
    ticks_per_frame = float(video_group.findtext("./TrackGroup/FrameRate"))
    return TICKS_PER_SECOND / ticks_per_frame


def get_ticks_per_frame_from_video_group(video_group: ET.Element) -> int:
    ticks_per_frame = video_group.findtext("./TrackGroup/FrameRate")
    if not ticks_per_frame:
        raise ValueError("No se encontró FrameRate en el grupo de vídeo.")
    return int(ticks_per_frame)


def get_frame_size_from_video_group(video_group: ET.Element) -> tuple[int, int]:
    rect = video_group.findtext("FrameRect")
    if not rect:
        raise ValueError("No se encontró FrameRect en el grupo de vídeo.")
    parts = [int(p) for p in rect.split(",")]
    return parts[2], parts[3]


def get_video_tracks(video_group: ET.Element, by_uid: dict[str, ET.Element]) -> list[ET.Element]:
    tracks = []
    for track_ref in video_group.findall("./TrackGroup/Tracks/Track"):
        track_uid = track_ref.attrib["ObjectURef"]
        tracks.append(by_uid[track_uid])
    return tracks


def get_or_create_track_items_container(video_track: ET.Element) -> ET.Element:
    clip_items = video_track.find("./ClipTrack/ClipItems")
    if clip_items is None:
        raise ValueError("No se encontró ClipItems en la pista de vídeo.")
    track_items = clip_items.find("TrackItems")
    if track_items is None:
        track_items = ET.Element("TrackItems", {"Version": "1"})
        clip_items.insert(0, track_items)
    return track_items


def get_track_items_refs(video_track: ET.Element) -> list[int]:
    track_items = video_track.find("./ClipTrack/ClipItems/TrackItems")
    if track_items is None:
        return []
    return [int(el.attrib["ObjectRef"]) for el in track_items.findall("TrackItem")]


def highest_occupied_track_index(video_group: ET.Element, by_uid: dict[str, ET.Element]) -> int:
    tracks = get_video_tracks(video_group, by_uid)
    for idx in range(len(tracks) - 1, -1, -1):
        if get_track_items_refs(tracks[idx]):
            return idx
    return -1


def clone_empty_video_track(template_track: ET.Element, new_uid: str, track_id: int, track_index: int) -> ET.Element:
    new_track = deep_copy(template_track)
    new_track.attrib["ObjectUID"] = new_uid

    track = new_track.find("./ClipTrack/Track")
    if track is None:
        raise ValueError("Track template inválido.")

    track_id_el = track.find("ID")
    if track_id_el is not None:
        track_id_el.text = str(track_id)
    track_index_el = track.find("Index")
    if track_index_el is not None:
        track_index_el.text = str(track_index)

    clip_items = new_track.find("./ClipTrack/ClipItems")
    if clip_items is not None:
        clip_items_index = clip_items.find("Index")
        if clip_items_index is not None:
            clip_items_index.text = str(track_index)
    if clip_items is not None:
        for child in list(clip_items):
            if child.tag == "TrackItems":
                clip_items.remove(child)

    transition_items = new_track.find("./ClipTrack/TransitionItems")
    if transition_items is not None:
        transition_items_index = transition_items.find("Index")
        if transition_items_index is not None:
            transition_items_index.text = str(track_index)

    return new_track


def ensure_top_video_tracks(
    root: ET.Element,
    by_id: dict[int, ET.Element],
    by_uid: dict[str, ET.Element],
    sequence: ET.Element,
    needed_tracks: int,
) -> tuple[int, list[ET.Element]]:
    video_group_ref, _, _ = get_sequence_track_group_refs(sequence)
    video_group = by_id[video_group_ref]
    tracks = get_video_tracks(video_group, by_uid)
    highest_occupied = highest_occupied_track_index(video_group, by_uid)
    base_track_index = highest_occupied + 1
    reusable_top_tracks = len(tracks) - base_track_index
    missing = needed_tracks - reusable_top_tracks

    if missing <= 0:
        return base_track_index, get_video_tracks(video_group, by_uid)

    next_track_id_el = video_group.find("./TrackGroup/NextTrackID")
    if next_track_id_el is None:
        raise ValueError("No se encontró NextTrackID en VideoTrackGroup.")
    next_track_id = int(next_track_id_el.text or "1")

    tracks_parent = video_group.find("./TrackGroup/Tracks")
    if tracks_parent is None:
        raise ValueError("No se encontró la lista de pistas de vídeo.")

    template_track = tracks[-1]
    for _ in range(missing):
        new_uid = str(uuid.uuid4())
        new_track = clone_empty_video_track(template_track, new_uid, next_track_id, len(tracks))
        append_object(root, by_id, by_uid, new_track)

        ET.SubElement(tracks_parent, "Track", {"Index": str(len(tracks)), "ObjectURef": new_uid})
        tracks.append(new_track)
        next_track_id += 1

    next_track_id_el.text = str(next_track_id)
    return base_track_index, tracks


def next_object_id(by_id: dict[int, ET.Element]) -> int:
    return max(by_id) + 1


def next_track_item_node_id(root: ET.Element) -> int:
    max_id = 1_000_000
    for track_item in root.findall(".//TrackItem"):
        node_id = track_item.findtext("./Node/ID")
        if node_id and node_id.isdigit():
            max_id = max(max_id, int(node_id))
    return max_id + 1


def find_donor_template(
    root: ET.Element,
    by_id: dict[int, ET.Element],
    by_uid: dict[str, ET.Element],
    donor_sequence_name: str,
) -> tuple[ET.Element, ET.Element, ET.Element, list[ET.Element], int]:
    donor_sequence = find_sequence_by_name(root, donor_sequence_name)
    donor_video_group_ref, _, _ = get_sequence_track_group_refs(donor_sequence)
    donor_video_group = by_id[donor_video_group_ref]
    donor_tracks = get_video_tracks(donor_video_group, by_uid)

    donor_track_item_ref = None
    for track in donor_tracks:
        refs = get_track_items_refs(track)
        if refs:
            donor_track_item_ref = refs[0]
            break
    if donor_track_item_ref is None:
        raise ValueError(f"La secuencia '{donor_sequence_name}' no tiene ningún clip de texto de plantilla.")

    donor_track_item = by_id[donor_track_item_ref]
    donor_chain_ref = int(donor_track_item.find("./ClipTrackItem/ComponentOwner/Components").attrib["ObjectRef"])
    donor_chain = by_id[donor_chain_ref]
    donor_filter_ref = int(donor_chain.find("./ComponentChain/Components/Component").attrib["ObjectRef"])
    donor_filter = by_id[donor_filter_ref]
    donor_params = [by_id[int(param.attrib["ObjectRef"])] for param in donor_filter.findall("./Component/Params/Param")]
    donor_subclip_ref = int(donor_track_item.find("./ClipTrackItem/SubClip").attrib["ObjectRef"])

    return donor_track_item, donor_chain, donor_filter, donor_params, donor_subclip_ref


def find_ascii_runs(data: bytes) -> list[tuple[int, bytes]]:
    runs = []
    start = None
    for idx, byte in enumerate(data):
        if 32 <= byte < 127:
            if start is None:
                start = idx
        else:
            if start is not None and idx - start >= 3:
                runs.append((start, data[start:idx]))
            start = None
    if start is not None and len(data) - start >= 3:
        runs.append((start, data[start:]))
    return runs


def detect_font_and_text_offsets(payload: bytes) -> tuple[int, bytes, int, bytes]:
    runs = find_ascii_runs(payload)
    font_candidates = [(offset, run) for offset, run in runs if b"-" in run and re.search(rb"[A-Za-z]", run)]
    if not font_candidates:
        raise ValueError("No se pudo localizar la cadena de fuente en el payload Source Text.")
    font_offset, font_bytes = font_candidates[0]

    if len(runs) < 2:
        raise ValueError("No se pudo localizar la cadena de texto en el payload Source Text.")
    text_offset, text_bytes = runs[-1]
    return font_offset, font_bytes, text_offset, text_bytes


def aligned_string_block(value: bytes) -> bytes:
    padding = (-len(value)) % 4
    return value + (b"\x00" * padding)


def replace_padded_string_block(payload: bytes, string_offset: int, old_string: bytes, new_string: bytes) -> bytes:
    old_block_start = string_offset
    old_block_end = string_offset + len(old_string)
    while old_block_end < len(payload) and payload[old_block_end] == 0:
        old_block_end += 1

    return payload[:old_block_start] + aligned_string_block(new_string) + payload[old_block_end:]


def patch_source_text_payload(payload_b64: str, text_value: str, font_family: str) -> str:
    payload = base64.b64decode(payload_b64.strip())
    font_offset, font_bytes, text_offset, text_bytes = detect_font_and_text_offsets(payload)

    font_value = font_family.encode("utf-8") if font_family else font_bytes
    text_value_bytes = text_value.encode("utf-8")

    # Replace the later text block first so earlier offsets remain valid.
    text_len_off = text_offset - 4
    payload = payload[:text_len_off] + struct.pack("<I", len(text_value_bytes)) + payload[text_offset:]
    payload = replace_padded_string_block(payload, text_offset, text_bytes, text_value_bytes)

    # Re-detect the font block after the text mutation in case the payload shifted.
    font_offset, font_bytes, _, _ = detect_font_and_text_offsets(payload)
    font_len_off = font_offset - 4
    payload = payload[:font_len_off] + struct.pack("<I", len(font_value)) + payload[font_offset:]
    payload = replace_padded_string_block(payload, font_offset, font_bytes, font_value)

    payload = struct.pack("<I", len(payload) - 12) + payload[4:]
    return base64.b64encode(payload).decode("ascii")


def format_float(value: float) -> str:
    text = f"{value:.12f}".rstrip("0").rstrip(".")
    if "." not in text:
        text += "."
    return text


def set_param_text(param: ET.Element, text: str) -> None:
    for child in param:
        if child.tag == "StartKeyframeValue":
            child.text = text
            return
    raise ValueError("No se encontró StartKeyframeValue en el parámetro de texto.")


def set_position_param(param: ET.Element, normalized_x: float, normalized_y: float) -> None:
    start = param.find("StartKeyframe")
    if start is None or not start.text:
        raise ValueError("No se encontró StartKeyframe en Position.")
    parts = start.text.split(",")
    if len(parts) < 2:
        raise ValueError("Formato inesperado en Position StartKeyframe.")
    parts[1] = f"{format_float(normalized_x)}:{format_float(normalized_y)}"
    start.text = ",".join(parts)


def set_scalar_start_keyframe(param: ET.Element, value: float) -> None:
    start = param.find("StartKeyframe")
    if start is None or not start.text:
        raise ValueError("No se encontró StartKeyframe en el parámetro escalar.")
    parts = start.text.split(",")
    if len(parts) < 2:
        raise ValueError("Formato inesperado de StartKeyframe escalar.")
    parts[1] = format_float(value)
    start.text = ",".join(parts)


def seconds_to_ticks(seconds: float, ticks_per_frame: int) -> int:
    frame_number = int(round((seconds * TICKS_PER_SECOND) / ticks_per_frame))
    return frame_number * ticks_per_frame


def update_sequence_metadata(sequence: ET.Element, max_end_ticks: int, total_video_tracks: int) -> None:
    props = sequence.find("./Node/Properties")
    if props is None:
        raise ValueError("La secuencia target no tiene propiedades de nodo.")

    work_out_point = props.find("MZ.WorkOutPoint")
    if work_out_point is None:
        work_out_point = ET.SubElement(props, "MZ.WorkOutPoint")
    previous_ticks = int(work_out_point.text or "0")
    work_out_point.text = str(max(previous_ticks, max_end_ticks))

    for child in props:
        if not child.tag.startswith("HSL.TimelinePatchingAndTargeting.VideoPatches"):
            continue
        try:
            patches = json.loads(child.text or "[]")
        except json.JSONDecodeError:
            break

        if not patches:
            patches = [{"mNumber": 0, "mState": 2}]

        while len(patches) < total_video_tracks:
            patches.append({"mNumber": -1, "mState": 0})
        if len(patches) > total_video_tracks:
            patches = patches[:total_video_tracks]

        child.text = json.dumps(patches, separators=(",", ":"))
        break


def update_sequence_source_durations(root: ET.Element, sequence_uid: str, max_end_ticks: int) -> None:
    for obj in root:
        if obj.tag not in {"AudioSequenceSource", "VideoSequenceSource"}:
            continue
        sequence_ref = obj.find("./SequenceSource/Sequence")
        if sequence_ref is None or sequence_ref.attrib.get("ObjectURef") != sequence_uid:
            continue

        original_duration = obj.find("OriginalDuration")
        if original_duration is None:
            original_duration = ET.SubElement(obj, "OriginalDuration")
        original_duration.text = str(max_end_ticks)


def create_clip_from_word(
    root: ET.Element,
    by_id: dict[int, ET.Element],
    by_uid: dict[str, ET.Element],
    donor_track_item: ET.Element,
    donor_chain: ET.Element,
    donor_filter: ET.Element,
    donor_params: list[ET.Element],
    donor_subclip_ref: int,
    word: WordUnit,
    track: ET.Element,
    frame_width: int,
    frame_height: int,
    template_font_size: float,
    next_node_id: int,
    ticks_per_frame: int,
) -> int:
    new_track_item_id = next_object_id(by_id)
    new_chain_id = new_track_item_id + 1
    new_filter_id = new_track_item_id + 2
    param_ids = list(range(new_track_item_id + 3, new_track_item_id + 3 + len(donor_params)))

    new_track_item = deep_copy(donor_track_item)
    new_track_item.attrib["ObjectID"] = str(new_track_item_id)
    new_track_item.find("./ClipTrackItem/ComponentOwner/Components").attrib["ObjectRef"] = str(new_chain_id)
    subclip = new_track_item.find("./ClipTrackItem/SubClip")
    if subclip is None:
        raise ValueError("El clip donor no tiene SubClip.")
    subclip.attrib["ObjectRef"] = str(donor_subclip_ref)

    track_item_el = new_track_item.find("./ClipTrackItem/TrackItem")
    if track_item_el is None:
        raise ValueError("El clip donor no tiene TrackItem.")
    node_id_el = track_item_el.find("./Node/ID")
    if node_id_el is not None:
        node_id_el.text = str(next_node_id)

    start_el = track_item_el.find("Start")
    if start_el is None:
        start_el = ET.Element("Start")
        track_item_el.insert(1, start_el)
    end_el = track_item_el.find("End")
    if end_el is None:
        end_el = ET.SubElement(track_item_el, "End")

    start_el.text = str(seconds_to_ticks(word.start_seconds, ticks_per_frame))
    end_el.text = str(seconds_to_ticks(word.end_seconds, ticks_per_frame))

    new_chain = deep_copy(donor_chain)
    new_chain.attrib["ObjectID"] = str(new_chain_id)
    component_ref = new_chain.find("./ComponentChain/Components/Component")
    if component_ref is None:
        raise ValueError("La cadena donor no tiene VideoFilterComponent.")
    component_ref.attrib["ObjectRef"] = str(new_filter_id)

    new_filter = deep_copy(donor_filter)
    new_filter.attrib["ObjectID"] = str(new_filter_id)
    new_filter.find("./Component/InstanceName").text = word.text
    param_refs = new_filter.findall("./Component/Params/Param")
    if len(param_refs) != len(param_ids):
        raise ValueError("El número de parámetros del filtro donor no coincide.")
    for param_ref, param_id in zip(param_refs, param_ids):
        param_ref.attrib["ObjectRef"] = str(param_id)

    cloned_params = []
    for donor_param, param_id in zip(donor_params, param_ids):
        new_param = deep_copy(donor_param)
        new_param.attrib["ObjectID"] = str(param_id)
        cloned_params.append(new_param)

    source_text_param = None
    position_param = None
    scale_param = None
    hscale_param = None
    for param in cloned_params:
        name = param.findtext("Name", "")
        if name == "Source Text":
            source_text_param = param
        elif name == "Position":
            position_param = param
        elif name == "Scale":
            scale_param = param
        elif name == "Horizontal Scale":
            hscale_param = param

    if source_text_param is None or position_param is None or scale_param is None or hscale_param is None:
        raise ValueError("No se localizaron todos los parámetros esperados en el donor.")

    source_text_b64 = source_text_param.findtext("StartKeyframeValue")
    if not source_text_b64:
        raise ValueError("El donor no tiene payload base64 en Source Text.")
    patched_b64 = patch_source_text_payload(source_text_b64, word.text, word.font_family)
    set_param_text(source_text_param, patched_b64)

    normalized_x = word.x / frame_width
    normalized_y = word.y / frame_height
    set_position_param(position_param, normalized_x, normalized_y)

    scale_value = 100.0
    if template_font_size > 0 and word.font_size > 0:
        scale_value = (word.font_size / template_font_size) * 100.0
    set_scalar_start_keyframe(scale_param, scale_value)
    set_scalar_start_keyframe(hscale_param, scale_value)

    append_object(root, by_id, by_uid, new_track_item)
    append_object(root, by_id, by_uid, new_chain)
    append_object(root, by_id, by_uid, new_filter)
    for param in cloned_params:
        append_object(root, by_id, by_uid, param)

    track_items = get_or_create_track_items_container(track)
    next_index = len(track_items.findall("TrackItem"))
    ET.SubElement(track_items, "TrackItem", {"Index": str(next_index), "ObjectRef": str(new_track_item_id)})

    return next_node_id + 1


def write_project_xml(path: Path, root: ET.Element) -> None:
    xml_bytes = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    path.write_bytes(xml_bytes)


def write_project_prproj(path: Path, root: ET.Element) -> None:
    xml_bytes = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    with gzip.open(path, "wb") as fh:
        fh.write(xml_bytes)


def load_project_root(path: Path) -> ET.Element:
    xml_bytes = gzip.decompress(path.read_bytes())
    return ET.fromstring(xml_bytes)


def main() -> None:
    parser = argparse.ArgumentParser(description="Crea clips de texto en un .prproj a partir de un JSON editorial.")
    parser.add_argument("--template-prproj", required=True, help="Proyecto base .prproj/.bak con una secuencia target y otra donor.")
    parser.add_argument("--json", required=True, help="JSON editorial/layout de entrada.")
    parser.add_argument("--output-prproj", required=True, help="Ruta del .prproj de salida.")
    parser.add_argument("--output-xml", help="Ruta opcional del XML descomprimido de salida.")
    parser.add_argument("--target-sequence", default="Empty", help="Secuencia donde inyectar los clips.")
    parser.add_argument("--donor-sequence", default="Text", help="Secuencia que contiene el clip de texto plantilla.")
    parser.add_argument("--template-font-size", type=float, default=154.0, help="Font size visual del clip donor para mapear Scale.")
    args = parser.parse_args()

    template_prproj = Path(args.template_prproj)
    json_path = Path(args.json)
    output_prproj = Path(args.output_prproj)

    root = load_project_root(template_prproj)
    by_id, by_uid = index_objects(root)

    target_sequence = find_sequence_by_name(root, args.target_sequence)
    target_video_group_ref, _, _ = get_sequence_track_group_refs(target_sequence)
    target_video_group = by_id[target_video_group_ref]
    fps = get_frame_rate_from_video_group(target_video_group)
    ticks_per_frame = get_ticks_per_frame_from_video_group(target_video_group)
    frame_width, frame_height = get_frame_size_from_video_group(target_video_group)

    items = parse_layout_json(json_path, fps)
    if not items:
        raise SystemExit("No se encontraron bloques válidos en el JSON.")

    word_units = build_word_units(items, fps)
    if not word_units:
        raise SystemExit("No se pudieron generar words válidas desde el JSON.")

    max_words = max(unit.word_count for unit in word_units)
    base_track_index, tracks = ensure_top_video_tracks(root, by_id, by_uid, target_sequence, max_words)

    donor_track_item, donor_chain, donor_filter, donor_params, donor_subclip_ref = find_donor_template(
        root, by_id, by_uid, args.donor_sequence
    )

    next_node_id = next_track_item_node_id(root)
    max_end_ticks = 0
    for word in word_units:
        track = tracks[base_track_index + word.word_index]
        max_end_ticks = max(max_end_ticks, seconds_to_ticks(word.end_seconds, ticks_per_frame))
        next_node_id = create_clip_from_word(
            root=root,
            by_id=by_id,
            by_uid=by_uid,
            donor_track_item=donor_track_item,
            donor_chain=donor_chain,
            donor_filter=donor_filter,
            donor_params=donor_params,
            donor_subclip_ref=donor_subclip_ref,
            word=word,
            track=track,
            frame_width=frame_width,
            frame_height=frame_height,
            template_font_size=args.template_font_size,
            next_node_id=next_node_id,
            ticks_per_frame=ticks_per_frame,
        )

    if max_end_ticks > 0:
        update_sequence_metadata(target_sequence, max_end_ticks=max_end_ticks, total_video_tracks=len(tracks))
        update_sequence_source_durations(root, sequence_uid=target_sequence.attrib["ObjectUID"], max_end_ticks=max_end_ticks)

    output_prproj.parent.mkdir(parents=True, exist_ok=True)
    write_project_prproj(output_prproj, root)

    if args.output_xml:
        output_xml = Path(args.output_xml)
        output_xml.parent.mkdir(parents=True, exist_ok=True)
        write_project_xml(output_xml, root)

    print(f"OK: clips creados = {len(word_units)}")
    print(f"OK: max_words = {max_words}")
    print(f"OK: base_track_index = {base_track_index}")
    print(f"OK: output = {output_prproj}")


if __name__ == "__main__":
    main()
