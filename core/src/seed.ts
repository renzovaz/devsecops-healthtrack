/**
 * DADOS HIPOTÉTICOS. Médicos, IDs e horários são fictícios, criados só para a demonstração.
 * Não há nenhum dado que represente pessoa real (nada de CPF, telefone ou e-mail).
 */

export interface Doctor {
  doctorId: string;
  displayName: string;
  /** Horários de atendimento oferecidos em cada dia (HH:MM). */
  slots: string[];
}

export const DEMO_DOCTORS: readonly Doctor[] = [
  { doctorId: 'doctor-001', displayName: 'Dra. Exemplo A', slots: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'] },
  { doctorId: 'doctor-002', displayName: 'Dr. Exemplo B', slots: ['14:00', '14:30', '15:00', '15:30'] },
];

export function findDoctor(doctorId: string): Doctor | undefined {
  return DEMO_DOCTORS.find((d) => d.doctorId === doctorId);
}
