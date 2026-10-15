"""Bounded CPU algorithms used by the app's file-inference adapter."""

import os
from pathlib import Path

import numpy as np


class RetrievalIndexCache:
    """Keep one unchanged index; release it on selection changes or unload."""

    def __init__(self, read_index, max_bytes=256 * 1024 * 1024):
        self.read_index = read_index
        self.max_bytes = max_bytes
        self.clear()

    def clear(self):
        self.key = self.index = self.vectors = None

    def get(self, filename, rate):
        if not filename or rate <= 0:
            self.clear()
            return None, None
        try:
            filename = str(Path(filename).resolve())
            stat = os.stat(filename)
            key = (filename, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size)
            if self.key == key:
                return self.index, self.vectors
            # Avoid retaining a second index while loading a replacement.
            self.clear()
            index = self.read_index(filename)
            vectors = index.reconstruct_n(0, index.ntotal)
            after = os.stat(filename)
            if (after.st_mtime_ns, after.st_ctime_ns, after.st_size) != key[1:]:
                raise ValueError("Index changed while loading; retry conversion")
            if stat.st_size + vectors.nbytes <= self.max_bytes:
                self.key, self.index, self.vectors = key, index, vectors
            return index, vectors
        except (OSError, RuntimeError, ValueError) as error:
            self.clear()
            print(f"An error occurred reading the FAISS index: {error}")
            return None, None


def retrieve_embeddings(queries, index, vectors, batch_size=256, k=8):
    """Same eight-neighbor inverse-square weighting, with bounded gathers.

    A full [frames, 8, embedding_dimensions] gather can dwarf the input.
    Only batch_size frames are materialized at a time. Exact matches share
    their weight equally; missing neighbors never address the final vector.
    """
    queries = np.ascontiguousarray(queries, dtype=np.float32)
    result = np.empty_like(queries)
    if batch_size < 1:
        raise ValueError("Retrieval batch size must be positive")
    if not len(vectors):
        return queries.copy()
    # Preserve FAISS's query batch and distance rounding. Its small [frames, k]
    # result is cheap; the expensive neighbor-vector gather is batched below.
    all_scores, all_neighbors = index.search(queries, k=k)
    for start in range(0, len(queries), batch_size):
        query = queries[start : start + batch_size]
        scores = all_scores[start : start + batch_size]
        neighbors = all_neighbors[start : start + batch_size]
        valid = (
            (neighbors >= 0)
            & (neighbors < len(vectors))
            & np.isfinite(scores)
            & (scores >= 0)
        )
        distances = np.where(valid, scores, np.inf)
        closest = distances.min(axis=1, keepdims=True)
        # Retain the original arithmetic for ordinary scores. Scale only rows
        # whose reciprocal-square would overflow, keeping exact zeros separate.
        weights = np.zeros_like(distances)
        tiny = np.sqrt(1 / np.finfo(distances.dtype).max)
        ordinary = (closest >= tiny) & np.isfinite(closest)
        np.divide(
            1,
            distances,
            out=weights,
            where=valid & ordinary,
        )
        np.divide(
            closest,
            distances,
            out=weights,
            where=valid & (closest > 0) & (closest < tiny),
        )
        np.square(weights, out=weights)
        weights[valid & (distances == 0)] = 1
        totals = weights.sum(axis=1, keepdims=True)
        np.divide(weights, totals, out=weights, where=totals > 0)
        gathered = vectors[np.clip(neighbors, 0, max(0, len(vectors) - 1))]
        gathered[~valid] = 0
        retrieved = np.sum(gathered * weights[:, :, None], axis=1)
        # An empty index may return eight missing neighbors for every query.
        result[start : start + len(query)] = np.where(totals > 0, retrieved, query)
    return result


def autotune_f0(f0, notes, strength):
    """Find the two surrounding notes instead of scanning every note/frame."""
    f0 = np.asarray(f0)
    if not f0.size or strength == 0:
        return f0.copy()
    notes = np.asarray(notes, dtype=f0.dtype)
    right = np.clip(np.searchsorted(notes, f0), 0, len(notes) - 1)
    left = np.maximum(0, right - 1)
    # The original scalar min() picks the lower note on an exact tie.
    nearest = np.where(
        np.abs(f0 - notes[left]) <= np.abs(notes[right] - f0),
        notes[left],
        notes[right],
    )
    return (f0 + (nearest - f0) * strength).astype(f0.dtype, copy=False)


def merge_audio(audio_segments_org, audio_segments_new, intervals, sr_orig, sr_new):
    """Preserve the engine's append/gap semantics in a single allocation."""
    if not audio_segments_new:
        return np.empty(0, dtype=np.float32)
    ratio = sr_new / sr_orig
    cursor = 0
    placements = []
    for segment, (start, end) in zip(audio_segments_new, intervals, strict=True):
        offset = max(cursor, int(start * ratio))
        placements.append((offset, segment))
        cursor = max(offset + len(segment), int(end * ratio))
    merged = np.zeros(cursor, dtype=audio_segments_new[0].dtype)
    for offset, segment in placements:
        merged[offset : offset + len(segment)] = segment
    return merged
