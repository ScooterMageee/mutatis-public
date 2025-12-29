import sys
import numpy as np
import random
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.bar import Bar

console = Console()

# 10k Vectors, 1536 Dimensions
VECTORS = 10000
DIMS = 1536


def run_memory_test():
    console.clear()
    console.print(Panel.fit("[bold magenta]MUTATIS MEMORY FOOTPRINT ANALYSIS[/bold magenta]", border_style="magenta"))

    console.print(f"[dim]Allocating {VECTORS} x {DIMS} floats...[/dim]\n")

    # --- 1. THE STANDARD WAY (Python Lists / JSON Objects) ---
    # Python ints/floats are objects. Lists store pointers to objects.
    # This is extremely memory heavy.

    # Generate the list
    py_data = [[random.random() for _ in range(DIMS)] for _ in range(VECTORS)]

    # Calculate approx size (Pointer list + Float objects)
    # A python float is 24 bytes. A list pointer is 8 bytes.
    # 10,000 * 1536 * (24 + 8) = approx bytes
    py_size_bytes = sys.getsizeof(py_data) + (VECTORS * sys.getsizeof(py_data[0])) + (VECTORS * DIMS * 24)
    py_size_mb = py_data.__sizeof__() + sum(sys.getsizeof(i) for i in py_data) + (VECTORS * DIMS * 24)
    py_size_mb = py_size_mb / (1024 * 1024)

    # --- 2. THE MUTATIS WAY (Packed Binary) ---
    # Float32 is exactly 4 bytes.
    # 10,000 * 1536 * 4
    mutatis_buffer = np.zeros((VECTORS, DIMS), dtype=np.float32)
    mutatis_size_bytes = mutatis_buffer.nbytes
    mutatis_size_mb = mutatis_size_bytes / (1024 * 1024)

    # --- RENDER RESULTS ---
    table = Table(title="RAM Usage (Cost Implication)", box=None)
    table.add_column("Architecture", style="bold")
    table.add_column("Memory Footprint", justify="right")
    table.add_column("Waste Factor", style="red")

    table.add_row(
        "Standard (Python Objects)",
        f"{py_size_mb:.2f} MB",
        f"{(py_size_mb/mutatis_size_mb):.1f}x BLOAT"
    )
    table.add_row(
        "Mutatis (Zero-Copy)",
        f"{mutatis_size_mb:.2f} MB",
        "-"
    )

    console.print(table)

    # Visual Bar Chart
    console.print("\n[bold]Visual Memory Allocation:[/bold]")
    console.print(f"Standard: ", end="")
    console.print(Bar(100, 0, 100, color="red"))

    scaled_mutatis = (mutatis_size_mb / py_size_mb) * 100
    console.print(f"Mutatis:  ", end="")
    console.print(Bar(100, 0, scaled_mutatis, color="green"))

    console.print(Panel(
        f"[bold white]FINANCIAL IMPACT:[/bold white]\n"
        f"Standard RAG requires [red]~{(py_size_mb/mutatis_size_mb):.0f}x more RAM[/red] to hold the same data.\n"
        f"Mutatis reduces cloud memory costs by over [green]80%[/green].",
        border_style="green"
    ))


if __name__ == "__main__":
    run_memory_test()
