"""Source-only Payments features, separate from the existing retail model contract."""
from calendar import monthrange
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
import math
from statistics import median
from typing import Iterable, Mapping

FEATURE_VERSION = 'payments-source-features-1.0.0'
FEATURE_NAMES = (
    'amount_log', 'weekday_sin', 'weekday_cos', 'month_sin', 'month_cos', 'month_end',
    'source_name_frequency_log', 'source_name_amount_delta_log', 'source_name_seen_in_fit',
)


def source_values(row: Mapping[str, str]):
    try:
        amount = Decimal(row['AMOUNT'])
        day = datetime.strptime(row['CHECK DATE'], '%m/%d/%Y').date()
    except (KeyError, ValueError, InvalidOperation):
        raise ValueError('INVALID_PAYMENT_AMOUNT_OR_US_DATE') from None
    if not amount.is_finite() or amount <= 0:
        raise ValueError('POSITIVE_FINITE_AMOUNT_REQUIRED')
    value = float(amount)
    if not math.isfinite(value):
        raise ValueError('MODEL_NUMERIC_RANGE_UNSUPPORTED')
    # Exact source display name is a grouping key, not a verified legal identity.
    name = row.get('VENDOR NAME')
    return math.log1p(value), day, name if isinstance(name, str) and name.strip() else None


@dataclass(frozen=True)
class SourceNameBaseline:
    counts: dict[str, int]
    median_logs: dict[str, float]
    global_median_log: float

    @classmethod
    def fit(cls, fit_rows: Iterable[Mapping[str, str]]):
        groups, logs = defaultdict(list), []
        for row in fit_rows:
            amount_log, _, name = source_values(row)
            logs.append(amount_log)
            if name is not None:
                groups[name].append(amount_log)
        if len(logs) < 2:
            raise ValueError('AT_LEAST_TWO_FIT_ROWS_REQUIRED')
        return cls({name: len(values) for name, values in groups.items()},
                   {name: median(values) for name, values in groups.items()}, median(logs))

    def transform(self, row: Mapping[str, str]):
        amount_log, day, name = source_values(row)
        known = name in self.counts
        return {
            'amount_log': amount_log,
            'weekday_sin': math.sin(2*math.pi*day.weekday()/7),
            'weekday_cos': math.cos(2*math.pi*day.weekday()/7),
            'month_sin': math.sin(2*math.pi*(day.month-1)/12),
            'month_cos': math.cos(2*math.pi*(day.month-1)/12),
            'month_end': float(day.day == monthrange(day.year, day.month)[1]),
            'source_name_frequency_log': math.log1p(self.counts.get(name, 0)),
            'source_name_amount_delta_log': amount_log-self.median_logs.get(name, self.global_median_log),
            'source_name_seen_in_fit': float(known),
        }
