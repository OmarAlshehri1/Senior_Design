"""Keep the initial Production code release independent of unapplied Feed schema."""
import os
from urllib.parse import urlsplit


def enabled():
    configured = os.getenv('FEED_REVIEW_ENABLED')
    if configured is not None:
        return configured.lower() == 'true'
    return urlsplit(os.getenv('SUPABASE_URL', '')).hostname == 'gunvsnvxipetxavpajjv.supabase.co'
