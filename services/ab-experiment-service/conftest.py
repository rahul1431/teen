"""Pytest configuration file."""
import sys
import os

# Add src directory to Python path
src_dir = os.path.join(os.path.dirname(__file__), 'src')
sys.path.insert(0, src_dir)
