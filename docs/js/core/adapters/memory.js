/** Adapters em memória: substituem RDS, ElastiCache e SQS na demonstração e nos testes. */
export class InMemoryAppointmentRepository {
    items = new Map();
    slotKey(a) {
        return `${a.doctorId}|${a.date}|${a.time}`;
    }
    async findByDoctorAndDate(doctorId, date) {
        return [...this.items.values()].filter((a) => a.doctorId === doctorId && a.date === date).map((a) => ({ ...a }));
    }
    async insertIfSlotFree(appointment) {
        const key = this.slotKey(appointment);
        if (this.items.has(key))
            return false;
        this.items.set(key, { ...appointment });
        return true;
    }
    clear() {
        this.items.clear();
    }
}
export class InMemoryCache {
    store = new Map();
    async get(key) {
        const v = this.store.get(key);
        return v ? [...v] : undefined;
    }
    async set(key, slots) {
        this.store.set(key, [...slots]);
    }
    async delete(key) {
        this.store.delete(key);
    }
    clear() {
        this.store.clear();
    }
}
/** Guarda os eventos que "iriam para o SQS". */
export class InMemoryEventPublisher {
    published = [];
    async publish(event) {
        this.published.push(structuredClone(event));
    }
}
export class SystemClock {
    now() {
        return Date.now();
    }
}
/** Relógio controlável, para testes determinísticos. */
export class FixedClock {
    current;
    constructor(current) {
        this.current = current;
    }
    now() {
        return this.current;
    }
    advance(ms) {
        this.current += ms;
    }
}
