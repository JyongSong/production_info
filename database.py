"""Database initialisation stub.

The application now uses Supabase (via supabase_client) instead of local
SQLite.  This module is kept only so that existing ``from database import
initialize_database`` calls continue to work without error.

Run ``supabase_setup.sql`` in the Supabase SQL Editor to create the
required tables.
"""


def initialize_database() -> None:
    """No-op – tables are managed in Supabase."""
