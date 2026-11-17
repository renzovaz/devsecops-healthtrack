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
export {};
