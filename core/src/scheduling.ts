import type { Appointment, AppointmentCreatedEvent, AppointmentRepository, AvailabilityCache, Clock, EventPublisher } from './ports.js';
import { findDoctor } from './seed.js';

/** Regra de negócio do scheduling-service (seção 6.2, passo 5). */

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DOCTOR_RE = /^doctor-\d{3}$/;

export interface SchedulingDeps {
  repo: AppointmentRepository;
  cache: AvailabilityCache;
  publisher: EventPublisher;
  clock: Clock;
}

export type DomainError =
  | { kind: 'validation'; message: string }
  | { kind: 'not_found'; message: string }
  | { kind: 'conflict'; message: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export function cacheKey(doctorId: string, date: string): string {
  return `availability:${doctorId}:${date}`;
}

function validateDoctorAndDate(doctorId: unknown, date: unknown): DomainError | undefined {
  if (typeof doctorId !== 'string' || !DOCTOR_RE.test(doctorId)) return { kind: 'validation', message: 'doctorId inválido (formato doctor-NNN)' };
  if (typeof date !== 'string' || !DATE_RE.test(date)) return { kind: 'validation', message: 'date inválida (formato AAAA-MM-DD)' };
  if (!findDoctor(doctorId)) return { kind: 'not_found', message: 'médico não encontrado' };
  return undefined;
}

/**
 * Consulta de disponibilidade com cache-aside: tenta o cache (ElastiCache no estudo);
 * se não houver, calcula a partir do repositório (RDS) e grava no cache.
 */
export async function getAvailability(
  deps: SchedulingDeps,
  doctorId: unknown,
  date: unknown,
): Promise<Result<{ doctorId: string; date: string; slots: string[]; source: 'cache' | 'database' }>> {
  const err = validateDoctorAndDate(doctorId, date);
  if (err) return { ok: false, error: err };
  const d = doctorId as string;
  const dt = date as string;
  const key = cacheKey(d, dt);
  const cached = await deps.cache.get(key);
  if (cached) return { ok: true, value: { doctorId: d, date: dt, slots: cached, source: 'cache' } };
  const booked = new Set((await deps.repo.findByDoctorAndDate(d, dt)).map((a) => a.time));
  const slots = findDoctor(d)!.slots.filter((s) => !booked.has(s));
  await deps.cache.set(key, slots);
  return { ok: true, value: { doctorId: d, date: dt, slots, source: 'database' } };
}

export interface CreateAppointmentInput {
  doctorId: unknown;
  date: unknown;
  time: unknown;
}

export function buildAppointmentCreatedEvent(appointment: Appointment, traceId: string): AppointmentCreatedEvent {
  return {
    eventType: 'AppointmentCreated',
    version: 1,
    eventId: `evt-${appointment.appointmentId}`,
    occurredAt: appointment.createdAt,
    traceId,
    data: {
      appointmentId: appointment.appointmentId,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
      date: appointment.date,
      time: appointment.time,
    },
  };
}

/**
 * Cria o agendamento para o paciente autenticado (patientId vem da identidade já
 * validada pelo autorizador, nunca do corpo da requisição).
 */
export async function createAppointment(
  deps: SchedulingDeps,
  input: CreateAppointmentInput,
  patientId: string,
  traceId: string,
): Promise<Result<{ appointment: Appointment; event: AppointmentCreatedEvent }>> {
  const err = validateDoctorAndDate(input.doctorId, input.date);
  if (err) return { ok: false, error: err };
  if (typeof input.time !== 'string' || !TIME_RE.test(input.time)) return { ok: false, error: { kind: 'validation', message: 'time inválido (formato HH:MM)' } };
  const doctorId = input.doctorId as string;
  const date = input.date as string;
  const time = input.time;
  if (!findDoctor(doctorId)!.slots.includes(time)) return { ok: false, error: { kind: 'validation', message: 'horário fora da agenda do médico' } };

  const appointment: Appointment = {
    appointmentId: `appt-${doctorId}-${date}-${time.replace(':', '')}`,
    doctorId,
    patientId,
    date,
    time,
    createdAt: new Date(deps.clock.now()).toISOString(),
  };
  // O repositório (fonte da verdade) decide; o cache pode estar desatualizado.
  const inserted = await deps.repo.insertIfSlotFree(appointment);
  if (!inserted) return { ok: false, error: { kind: 'conflict', message: 'horário já ocupado' } };
  await deps.cache.delete(cacheKey(doctorId, date));
  const event = buildAppointmentCreatedEvent(appointment, traceId);
  await deps.publisher.publish(event);
  return { ok: true, value: { appointment, event } };
}
