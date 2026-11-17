/**
 * Ports (interfaces) do núcleo. Tudo que é externo ao domínio entra por aqui;
 * os adapters em memória (adapters/memory.ts) implementam estas interfaces,
 * o que deixa o núcleo determinístico e testável.
 *
 * Correspondência com a arquitetura do estudo (seção 6.1):
 *  - AppointmentRepository -> Amazon RDS PostgreSQL
 *  - AvailabilityCache     -> Amazon ElastiCache (Redis)
 *  - EventPublisher        -> Amazon SQS
 *  - Logger                -> CloudWatch Logs (logs estruturados em JSON)
 */

export interface Appointment {
  appointmentId: string;
  doctorId: string;
  /** Identificador pseudônimo do paciente (vem do `sub` do token). Nunca vai para o log. */
  patientId: string;
  date: string; // AAAA-MM-DD
  time: string; // HH:MM
  createdAt: string; // ISO 8601
}

export interface AppointmentRepository {
  findByDoctorAndDate(doctorId: string, date: string): Promise<Appointment[]>;
  /** Grava se o horário estiver livre; devolve false se já estiver ocupado. */
  insertIfSlotFree(appointment: Appointment): Promise<boolean>;
}

export interface AvailabilityCache {
  get(key: string): Promise<string[] | undefined>;
  set(key: string, slots: string[]): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface EventPublisher {
  publish(event: AppointmentCreatedEvent): Promise<void>;
}

export interface Clock {
  /** Milissegundos desde a época Unix. */
  now(): number;
}

export type LogLevel = 'info' | 'warn' | 'error';

/** Formato do log estruturado. Não há campo para dados pessoais de paciente (LGPD). */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  traceId: string;
  route: string;
  status: number;
  durationMs: number;
  message: string;
}

export interface Logger {
  log(entry: LogEntry): void;
}

export interface AppointmentCreatedEvent {
  eventType: 'AppointmentCreated';
  version: 1;
  eventId: string;
  occurredAt: string;
  traceId: string;
  data: {
    appointmentId: string;
    doctorId: string;
    patientId: string;
    date: string;
    time: string;
  };
}
