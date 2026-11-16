"""Friendly names and direction words for every attribute shown in the UI.

Code names (faced_ps, shotd_ps, ...) never reach the interface; everything is looked up here.
"""

# The 11 model features, in glyph order: visual | audio | editing | faces.
FEATURES = [
    "brightness", "saturation", "entropy", "warmness",
    "tempo", "loudness", "spec_centroid",
    "shotc_ps", "shotd_ps",
    "facec_ps", "faced_ps",
]

FEATURE_GROUP = {
    "brightness": "visual", "saturation": "visual", "entropy": "visual", "warmness": "visual",
    "tempo": "audio", "loudness": "audio", "spec_centroid": "audio",
    "shotc_ps": "editing", "shotd_ps": "editing",
    "facec_ps": "faces", "faced_ps": "faces",
}

# (friendly name, word for high values, word for low values)
FEATURE_WORDS = {
    "brightness": ("brightness", "brighter images", "darker images"),
    "saturation": ("color saturation", "more saturated colors", "more muted colors"),
    "entropy": ("visual complexity", "busier images", "simpler images"),
    "warmness": ("color warmth", "warmer colors", "cooler colors"),
    "tempo": ("music tempo", "faster tempo", "slower tempo"),
    "loudness": ("loudness", "louder audio", "quieter audio"),
    "spec_centroid": ("sound sharpness", "sharper sound", "duller sound"),
    "shotc_ps": ("shot changes per second", "more shot changes", "fewer shot changes"),
    "shotd_ps": ("mean shot length", "longer shots", "shorter shots"),
    "facec_ps": ("faces appearing per second", "more face appearances", "fewer face appearances"),
    "faced_ps": ("time with faces on screen", "more face time", "less face time"),
}

ISSUE_LABELS = {
    "alt_medicine": "Alternative medicine",
    "climate_change": "Climate change",
    "covid": "COVID-19",
    "election": "Elections",
    "gmo": "GMOs",
    "health": "Health",
    "russia_ukraine": "Russia-Ukraine",
    "vaccine": "Vaccines",
}
TAG_COLUMNS = list(ISSUE_LABELS)

ACCOUNT_LABELS = {"popular": "Popular account", "unpopular": "Ordinary account"}

DIMENSIONS = {
    "overall": ("msv_m", "msv_sd", "Sensation rating (overall)"),
    "arousal": ("dim_emotional_arousal_m", "dim_emotional_arousal_sd", "Emotional arousal"),
    "dramatic": ("dim_dramatic_impact_m", "dim_dramatic_impact_sd", "Dramatic impact"),
    "novelty": ("dim_novelty_m", "dim_novelty_sd", "Novelty"),
}

# 17 scale items grouped by dimension. Membership recovered from the data: each dim_*_m is the
# exact unweighted mean of these items (8 / 6 / 3), and msv_m is the mean of all 17.
ITEMS = {
    "Emotional arousal": ["powerful_impact", "emotional", "exciting", "strong_visual", "arousing", "involving", "stimulating", "strong_soundeffect"],
    "Dramatic impact": ["goosebump", "creative", "graphic", "intense", "strong_soundtrack", "dramatic"],
    "Novelty": ["unique", "novel", "unusual"],
}
ITEM_LABELS = {
    "unique": "Unique", "powerful_impact": "Powerful impact", "goosebump": "Gives goosebumps",
    "novel": "Novel", "emotional": "Emotional", "exciting": "Exciting", "strong_visual": "Strong visuals",
    "creative": "Creative", "graphic": "Graphic", "arousing": "Arousing", "unusual": "Unusual",
    "involving": "Involving", "intense": "Intense", "strong_soundtrack": "Strong soundtrack",
    "dramatic": "Dramatic", "stimulating": "Stimulating", "strong_soundeffect": "Strong sound effects",
}

FACE_EMOTIONS = ["anger", "disgust", "fear", "happiness", "neutral", "sadness", "surprise"]

# Every numeric attribute that can appear on an axis or in V7: key -> (label, unit/scale note, source id)
NUMERIC_ATTRS = {
    "msv_m": ("Sensation rating (overall)", "1-7 scale", "authors_ratings"),
    "dim_emotional_arousal_m": ("Emotional arousal", "1-7 scale", "authors_ratings"),
    "dim_dramatic_impact_m": ("Dramatic impact", "1-7 scale", "authors_ratings"),
    "dim_novelty_m": ("Novelty", "1-7 scale", "authors_ratings"),
    "msv_sd": ("Rater disagreement (SD)", "rating points", "authors_ratings"),
    "residual": ("Model error (predicted - actual)", "rating points", "our_analysis"),
    **{f: (FEATURE_WORDS[f][0].capitalize(), "authors' measure", "authors_features") for f in FEATURES},
    "log_duration": ("Video length", "log10 seconds", "authors_meta"),
    "log_engagement": ("Engagement (views + likes + comments)", "log10 count", "authors_meta"),
    "year": ("Year posted", "year", "authors_meta"),
    "face_age_avg": ("Estimated age of faces", "years", "authors_features"),
    **{f"face_{e}_avg": (f"Face emotion: {e}", "Face++ score 0-100", "authors_features") for e in FACE_EMOTIONS},
}

CATEGORICAL_ATTRS = {
    "issue": ("Issue", "authors_meta"),
    "account_type": ("Account type", "authors_meta"),
    "aspect": ("Aspect ratio", "authors_meta"),
    "has_speech": ("Speech detected", "authors_meta"),
    "no_face": ("No faces detected", "authors_features"),
    "silent": ("No audio track", "authors_features"),
}


def direction_phrase(feature: str, z: float) -> str:
    _, hi, lo = FEATURE_WORDS[feature]
    return hi if z > 0 else lo


def cluster_label(zs: dict, n_terms: int = 2) -> str:
    ranked = sorted(zs, key=lambda f: -abs(zs[f]))
    return ", ".join(direction_phrase(f, zs[f]) for f in ranked[:n_terms])
