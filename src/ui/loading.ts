/** The loading screen: status text and a progress bar, hidden when the world is ready. */
export class LoadingScreen {
  private readonly root = document.getElementById('loading') as HTMLDivElement;
  private readonly status = document.getElementById('loading-status') as HTMLParagraphElement;
  private readonly bar = document.getElementById('loading-progress') as HTMLProgressElement;

  set(text: string, fraction: number): void {
    this.status.textContent = text;
    this.bar.value = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  }

  fail(text: string): void {
    this.status.textContent = text;
    this.status.style.color = '#f0a08a';
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
