"""Vercel Services entrypoint for the existing FastAPI application."""

if __package__:
    # Supports importing as ``backend.main`` from the repository root.
    from .app.main import app
else:
    # Vercel loads this file from the backend service root as ``main:app``.
    from app.main import app

__all__ = ["app"]
