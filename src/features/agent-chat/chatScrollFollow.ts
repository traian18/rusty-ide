export class ChatScrollFollow {
  private atBottom = true;

  update(distanceFromBottom: number): void {
    this.atBottom = distanceFromBottom <= 48;
  }

  shouldFollow(enabled: boolean): boolean {
    return enabled && this.atBottom;
  }
}
