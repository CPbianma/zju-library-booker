import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertRequestedSpaceTimeAvailable,
  assertSeminarParticipantCount,
  buildSeminarConfirmationPayload,
  buildSingleStudyConfirmationPayload,
  buildSeatConfirmationPayload,
  doesSegmentContainInterval,
  isIntervalBlocked,
  parseCommandLineArguments,
  removeEmptyValues,
  resolveDate,
} from '../zju-booking.mjs';

test('解析命令行参数时保留预约类型和显式确认标记', () => {
  const options = parseCommandLineArguments([
    'book',
    '--type=singleStudy',
    '--date=2026-09-06',
    '--areaId=125',
    '--confirm',
  ]);

  assert.equal(options.command, 'book');
  assert.equal(options.type, 'singleStudy');
  assert.equal(options.date, '2026-09-06');
  assert.equal(options.areaId, '125');
  assert.equal(options.confirm, true);
  assert.throws(
    () => parseCommandLineArguments(['book', '--confirm=true']),
    /--confirm 不接受值/,
  );
});

test('清理请求对象时移除空值但保留零和非空数组', () => {
  assert.deepEqual(
    removeEmptyValues({ empty: '', missing: null, emptyList: [], zero: 0, values: ['x'] }),
    { zero: 0, values: ['x'] },
  );
});

test('校验指定日期和时间范围', () => {
  assert.equal(resolveDate('2026-09-06'), '2026-09-06');
  assert.throws(() => resolveDate('2026-02-30'), /不是有效日期/);
  assert.throws(() => resolveDate('next-week'), /today、tomorrow/);
});

test('识别空间预约时间冲突、边界和时长限制', () => {
  const availability = {
    date: '2026-09-06',
    startTime: '08:30',
    endTime: '22:30',
    minDurationMinutes: 60,
    maxDurationMinutes: 840,
    blockedIntervals: [{ startTime: '12:00', endTime: '13:00' }],
  };

  assert.equal(isIntervalBlocked('11:00', '12:00', availability.blockedIntervals), false);
  assert.equal(isIntervalBlocked('11:30', '12:01', availability.blockedIntervals), true);
  assert.doesNotThrow(() => (
    assertRequestedSpaceTimeAvailable(availability, '08:30', '09:30', '测试空间')
  ));
  assert.throws(
    () => assertRequestedSpaceTimeAvailable(availability, '11:30', '12:30', '测试空间'),
    /冲突/,
  );
  assert.throws(
    () => assertRequestedSpaceTimeAvailable(availability, '08:30', '09:00', '测试空间'),
    /不能少于 60/,
  );
});

test('构造普通座位确认载荷时只发送座位和时间段', () => {
  assert.deepEqual(
    buildSeatConfirmationPayload({ id: '6046', segmentId: '1554059' }),
    { seat_id: '6046', segment: '1554059' },
  );
});

test('按分钟比较座位时间段，避免字符串时间比较误选时段', () => {
  assert.equal(
    doesSegmentContainInterval(
      { start: '08:30', end: '12:00' },
      '09:00',
      '11:30',
    ),
    true,
  );
  assert.equal(
    doesSegmentContainInterval(
      { start: '08:30', end: '10:00' },
      '10:00',
      '11:00',
    ),
    false,
  );
});

test('构造空间确认载荷时自动匹配预设标题并脱离查询对象', () => {
  const options = {
    startTime: '08:30',
    endTime: '10:00',
    title: '单人研习',
    content: '学习',
    mobile: '13800138000',
    teamusers: '',
  };
  const spaceDetail = {
    readonlyTitle: '1',
    title: [{ id: '1', title: '单人研习' }],
  };

  assert.deepEqual(buildSingleStudyConfirmationPayload(options, '2026-09-06', '125', spaceDetail), {
    id: 2,
    day: '2026-09-06',
    start_time: '08:30',
    end_time: '10:00',
    title: '单人研习',
    content: '学习',
    mobile: '13800138000',
    room: '125',
    open: '1',
    file_name: '',
    file_url: '',
    titleId: '1',
  });
});

test('多人研讨间按提交账号加参与人数量校验人数', () => {
  assert.doesNotThrow(() => assertSeminarParticipantCount(
    { teamusers: '101,102' },
    { minPerson: '3', maxPerson: '6' },
  ));
  assert.throws(
    () => assertSeminarParticipantCount({ teamusers: '' }, { minPerson: '2', maxPerson: '6' }),
    /至少需要 2 人/,
  );
  assert.throws(
    () => assertSeminarParticipantCount(
      { teamusers: '101,102,103' },
      { minPerson: '1', maxPerson: '3' },
    ),
    /最多容纳 3 人/,
  );
});

test('多人研讨间沿用空间确认载荷并追加参与人', () => {
  const payload = buildSeminarConfirmationPayload(
    {
      startTime: '09:00',
      endTime: '11:00',
      title: '小组讨论',
      content: '课程讨论',
      mobile: '13800138000',
      teamusers: '101,102',
    },
    '2026-09-06',
    '206',
    { readonlyTitle: '2', title: [] },
  );

  assert.equal(payload.room, '206');
  assert.equal(payload.teamusers, '101,102');
  assert.equal(payload.id, 2);
});
