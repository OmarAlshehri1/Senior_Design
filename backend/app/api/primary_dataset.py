from fastapi import APIRouter, Depends, HTTPException, Response
from starlette.concurrency import run_in_threadpool

from app.services.identity import get_current_user
from app.services.primary_dataset import public_metadata
from app.repositories.identity import IdentityError
from app.repositories.supabase_transactions import SupabaseConfigurationError
import httpx

router = APIRouter(prefix='/system', tags=['system'])


@router.get('/dataset')
async def dataset(response: Response, user: dict = Depends(get_current_user)):
    response.headers['Cache-Control'] = 'no-store'
    try:
        return await run_in_threadpool(public_metadata)
    except (IdentityError, SupabaseConfigurationError, ValueError, OSError, httpx.HTTPError) as exc:
        raise HTTPException(503, 'Primary dataset information is unavailable.') from exc
