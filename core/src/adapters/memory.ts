import type { Appointment, AppointmentCreatedEvent, AppointmentRepository, AvailabilityCache, Clock, EventPublisher } from '../ports.js';

/** Adapters em memória: substituem RDS, ElastiCache e SQS na demonstração e nos testes. */

export class InMemoryAppointmentRepository implements AppointmentRepository {
  private readonly items = new Map<string, Appointment>();

  private slotKey(a: Pick<Appointment, 'doctorId' | 'date' | 'time'>): string {
    return `${a.doctorId}|${a.date}|${a.time}`;
  }

  async findByDoctorAndDate(doctorId: string, date: string): Promise<Appointment[]> {
    return [...this.items.values()].filter((a) => a.doctorId === doctorId && a.date === date).map((a) => ({ ...a }));
  }

  async insertIfSlotFree(appointment: Appointment): Promise<boolean> {
    const key = this.slotKey(appointment);
    if (this.items.has(key)) return false;
    this.items.set(key, { ...appointment });
    return true;
  }

  clear(): void {
    this.items.clear();
  }
}

export class InMemoryCache implements AvailabilityCache {
  private readonly store = new Map<string, string[]>();

  async get(key: string): Promise<string[] | undefined> {
    const v = this.store.get(key);
    return v ? [...v] : undefined;
  }

  async set(key: string, slots: string[]): Promise<void> {
    this.store.set(key, [...slots]);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/** Guarda os eventos que "iriam para o SQS". */
export class InMemoryEventPublisher implements EventPublisher {
  readonly published: AppointmentCreatedEvent[] = [];

  async publish(event: AppointmentCreatedEvent): Promise<void> {
    this.published.push(structuredClone(event));
  }
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/** Relógio controlável, para testes determinísticos. */
export class FixedClock implements Clock {
  constructor(private current: number) {}

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}
