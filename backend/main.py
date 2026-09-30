"""Vercel Services entrypoint for the existing FastAPI application."""

try:
    # Supports importing as ``backend.main`` from the repository root.
    from .app.main import app
except ImportError:
    # Vercel loads this file from the backend service root as ``main:app``.
    from app.main import app

__all__ = ["app"]
