import type { MessageQueue } from "../../src/queue/messageQueue.js";
import type { SendJob } from "../../src/types/index.js";

/** Records jobs instead of talking to BullMQ. `failing` makes enqueue reject, like Redis being down. */
export class FakeQueue implements MessageQueue {
  jobs: SendJob[] = [];
  failing = false;
  async enqueue(job: SendJob): Promise<void> {
    if (this.failing) throw new Error("ECONNREFUSED");
    if (this.jobs.some((j) => j.messageId === job.messageId)) return; // same job id: BullMQ ignores duplicates
    this.jobs.push(job);
  }
  async remove(messageId: string): Promise<void> {
    this.jobs = this.jobs.filter((j) => j.messageId !== messageId);
  }
  async sizeForGym(gymId: string): Promise<number> {
    return this.jobs.filter((j) => j.gymId === gymId).length;
  }
  async counts() {
    return { waiting: this.jobs.length, active: 0, delayed: 0, failed: 0 };
  }
  async close(): Promise<void> {}
}
