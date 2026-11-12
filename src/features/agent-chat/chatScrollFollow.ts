export class ChatScrollFollow {
  private atBottom = true;

  update(distanceFromBottom: number): void {
    this.atBottom = distanceFromBottom <= 48;
  }

  /** At (or within a few lines of) the bottom when last measured. */
  isAtBottom(): boolean {
    return this.atBottom;
  }

  shouldFollow(enabled: boolean): boolean {
    return enabled && this.atBottom;
  }
}
