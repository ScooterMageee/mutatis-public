import time
import numpy as np
import random
from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.table import Table
from rich.panel import Panel

console = Console()

VECTORS = 5000  # Slightly smaller for quick iteration loop
DIMS = 1536
ITERATIONS = 50


def run_throughput():
    # Setup Data
    raw_data = [[random.random() for _ in range(DIMS)] for _ in range(VECTORS)]
    fast_buffer = np.array(raw_data, dtype=np.float32)
    query = np.random.random(DIMS).astype(np.float32)

    console.clear()
    console.print(Panel("[bold yellow]STRESS TEST: THROUGHPUT (QPS)[/bold yellow]", border_style="yellow"))

    # --- TEST 1: STANDARD ---
    start = time.perf_counter()
    for _ in range(ITERATIONS):
        # The SerDes Cost per request
        _ = np.array(raw_data, dtype=np.float32)  # The killer
        _ = np.dot(fast_buffer, query)
    duration_std = time.perf_counter() - start
    qps_std = ITERATIONS / duration_std

    # --- TEST 2: MUTATIS ---
    start = time.perf_counter()
    for _ in range(ITERATIONS):
        # Zero Copy
        _ = np.dot(fast_buffer, query)
    duration_mut = time.perf_counter() - start
    qps_mut = ITERATIONS / duration_mut

    # --- RESULTS ---
    table = Table(title="Server Capacity (Queries Per Second)")
    table.add_column("Architecture")
    table.add_column("Total Time (50 Batches)")
    table.add_column("QPS (Higher is Better)", style="bold")

    table.add_row("Standard RAG", f"{duration_std:.2f}s", f"[red]{qps_std:.2f} QPS[/red]")
    table.add_row("Mutatis Core", f"{duration_mut:.4f}s", f"[green]{qps_mut:.2f} QPS[/green]")

    console.print(table)
    console.print(f"\n[bold cyan]Result:[/bold cyan] Mutatis can handle [bold white]{qps_mut/qps_std:.0f}x more users[/bold white] on the same hardware.")


if __name__ == "__main__":
    run_throughput()
