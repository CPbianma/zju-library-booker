import { z } from 'zod';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^\d{2}:\d{2}$/;

const optionalText = z.string().trim().max(120).optional();
const timeSchema = z.string()
  .regex(timePattern, '时间必须使用 HH:mm 格式')
  .refine(isValidTime, '时间超出有效范围');
const dateSchema = z.string()
  .regex(datePattern, '日期必须使用 YYYY-MM-DD 格式')
  .refine(isValidDate, '日期不是有效的日历日期');
const optionalTime = timeSchema.optional();

export const queryFiltersSchema = z.object({
  type: z.enum(['seat', 'singleStudy', 'seminar']),
  date: dateSchema,
  premisesId: z.literal('53'),
  areaId: optionalText,
  name: optionalText,
  floor: optionalText,
  startTime: optionalTime,
  endTime: optionalTime,
}).strict().superRefine((filters, context) => {
  if (Boolean(filters.startTime) !== Boolean(filters.endTime)) {
    context.addIssue({
      code: 'custom',
      message: '开始时间和结束时间必须同时填写',
      path: ['startTime'],
    });
  }
  if (
    filters.startTime
    && filters.endTime
    && minutesFromTime(filters.startTime) >= minutesFromTime(filters.endTime)
  ) {
    context.addIssue({
      code: 'custom',
      message: '开始时间必须早于结束时间',
      path: ['endTime'],
    });
  }
});

const candidateBaseSchema = z.object({
  key: z.string().min(1).max(240),
  type: z.enum(['seat', 'singleStudy', 'seminar']),
  queryDate: dateSchema,
  targetId: z.string().min(1).max(120),
  name: z.string().min(1).max(240),
  location: z.string().max(240),
  floor: z.string().max(80),
  available: z.boolean(),
  statusLabel: z.string().max(120),
});

const seatCandidateSchema = candidateBaseSchema.extend({
  kind: z.literal('seat'),
  type: z.literal('seat'),
  areaId: z.string().min(1).max(120),
  areaName: z.string().max(240),
  segmentId: z.string().min(1).max(120),
  actualStartTime: timeSchema,
  actualEndTime: timeSchema,
}).strict();

const spaceCandidateSchema = candidateBaseSchema.extend({
  kind: z.literal('space'),
  type: z.enum(['singleStudy', 'seminar']),
  parentId: z.string().max(120),
  topId: z.string().max(120),
  openStartTime: timeSchema.or(z.literal('')),
  openEndTime: timeSchema.or(z.literal('')),
  blockedIntervals: z.array(z.object({
    startTime: timeSchema,
    endTime: timeSchema,
  }).strict()).max(200),
  minDurationMinutes: z.number().nonnegative(),
  maxDurationMinutes: z.number().nonnegative(),
  minPersons: z.number().nonnegative(),
  maxPersons: z.number().nonnegative(),
  readonlyTitle: z.boolean(),
  titleOptions: z.array(z.object({
    id: z.string().max(120),
    title: z.string().max(240),
  }).strict()).max(100),
}).strict();

export const previewInputSchema = z.object({
  candidate: z.discriminatedUnion('kind', [seatCandidateSchema, spaceCandidateSchema]),
  date: dateSchema,
  startTime: optionalTime,
  endTime: optionalTime,
  title: z.string().trim().max(240).optional(),
  content: z.string().trim().max(2_000).optional(),
  mobile: z.string().trim().max(40).optional(),
  teamUserIds: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
}).strict();

export const favoriteInputSchema = z.object({
  type: z.enum(['seat', 'singleStudy', 'seminar']),
  targetId: z.string().min(1).max(120),
  name: z.string().min(1).max(240),
  location: z.string().max(240),
  floor: z.string().max(80),
  areaId: z.string().max(120).optional(),
}).strict();

export const favoriteIdSchema = z.string().uuid();
export const favoriteDirectionSchema = z.enum(['up', 'down']);

function isValidTime(value: string): boolean {
  const [hours = -1, minutes = -1] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function minutesFromTime(value: string): number {
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function isValidDate(value: string): boolean {
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  return parsedDate.getUTCFullYear() === year
    && parsedDate.getUTCMonth() === month - 1
    && parsedDate.getUTCDate() === day;
}
