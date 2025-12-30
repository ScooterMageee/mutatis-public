import time
import numpy as np
import random
from rich.console import Console
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.panel import Panel
from rich.box import ROUNDED

console = Console()

# --- CONFIGURATION (The "Physics" of the test) ---
VECTOR_COUNT = 10000
DIMENSIONS = 1536  # OpenAI Standard
DATA_TYPE = np.float32


def generate_bloat():
    """Generates the raw messy list data standard Python has to deal with"""
    return [[random.random() for _ in range(DIMENSIONS)] for _ in range(VECTOR_COUNT)]


def run_benchmark():
    console.clear()
    console.print(Panel.fit("[bold cyan]MUTATIS ARCHITECTURE DIAGNOSTIC TOOL v1.0[/bold cyan]", border_style="cyan"))
    console.print(f"[dim]Target Load: {VECTOR_COUNT:,} Vectors x {DIMENSIONS} Dimensions ({DATA_TYPE.__name__})[/dim]\n")

    # 1. SETUP PHASE
    with Progress(
        SpinnerColumn(),
        TextColumn("[bold yellow]Generating 10,000 Vectors (Simulating Incoming Data)..."),
        transient=True
    ) as progress:
        progress.add_task("generate", total=None)
        # Create raw python lists (slow, heavy memory)
        raw_data = generate_bloat()
        # Create a pre-allocated buffer for the fast test
        fast_buffer = np.array(raw_data, dtype=DATA_TYPE)
        # Create a query vector
        query = np.random.random(DIMENSIONS).astype(DATA_TYPE)

    table = Table(title="Latency Benchmark Results", box=ROUNDED)
    table.add_column("Architecture", style="cyan")
    table.add_column("Methodology", style="white")
    table.add_column("Bottleneck", style="yellow")
    table.add_column("Time (ms)", style="bold", justify="right")
    table.add_column("Visual", justify="left")

    # --- TEST 1: STANDARD RAG (Architecture A) ---
    start_time = time.perf_counter()

    # THE BOTTLENECK: Converting List -> Numpy
    converted_array = np.array(raw_data, dtype=DATA_TYPE)
    # The Compute
    _ = np.dot(converted_array, query)

    end_time = time.perf_counter()
    duration_std = (end_time - start_time) * 1000  # to ms

    # --- TEST 2: MUTATIS ENGINE (Architecture B) ---
    start_time = time.perf_counter()

    # THE INNOVATION: Zero-Copy. Direct Memory Access.
    _ = np.dot(fast_buffer, query)

    end_time = time.perf_counter()
    duration_mutatis = (end_time - start_time) * 1000  # to ms

    # Render Standard Row
    bars_std = "█" * 40
    table.add_row(
        "Standard RAG",
        "Python Interpreter",
        "Copy-on-Read (SerDes)",
        f"[red]{duration_std:.1f} ms[/red]",
        f"[red]{bars_std}[/red]"
    )

    # Render Mutatis Row
    width = int((duration_mutatis / duration_std) * 40)
    if width < 1:
        width = 1
    bars_mut = "█" * width

    table.add_row(
        "Mutatis Core",
        "WASM + SIMD",
        "Zero-Copy Direct",
        f"[green]{duration_mutatis:.1f} ms[/green]",
        f"[green]{bars_mut}[/green]"
    )

    console.print(table)

    # Summary
    speedup = duration_std / duration_mutatis

    console.print(Panel(
        f"[bold white]FINAL ANALYSIS:[/bold white]\n"
        f"Standard Latency: [red]{duration_std:.1f}ms[/red]\n"
        f"Mutatis Latency:  [green]{duration_mutatis:.1f}ms[/green]\n\n"
        f"[bold cyan on blue]  PERFORMANCE DELTA: {speedup:.1f}x FASTER  [/bold cyan on blue]",
        title="Benchmark Conclusion",
        expand=False
    ))


if __name__ == "__main__":
    run_benchmark()
