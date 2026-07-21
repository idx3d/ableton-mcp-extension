/** Session-stable minted IDs for SDK objects (ADR 0003). IDs are never reused. */
export class IdRegistry<T extends object> {
  private counter = 0;
  private readonly byObject = new Map<T, string>();
  private readonly byId = new Map<string, T>();

  constructor(private readonly prefix: string) {}

  idFor(obj: T): string {
    const existing = this.byObject.get(obj);
    if (existing) return existing;
    const id = `${this.prefix}${++this.counter}`;
    this.byObject.set(obj, id);
    this.byId.set(id, obj);
    return id;
  }

  resolve(id: string): T | undefined {
    return this.byId.get(id);
  }

  forget(obj: T): void {
    const id = this.byObject.get(obj);
    if (id !== undefined) {
      this.byObject.delete(obj);
      this.byId.delete(id);
    }
  }
}
