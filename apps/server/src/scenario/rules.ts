import type { Facts, ReplyPlan } from '@mira/protocol';
import { AppError } from '../http/errors.js';

export function photoRequested(text: string): boolean {
  const refused =
    /(?:不要|不想|不用|不看|别|拒绝|no\b|don't).{0,12}(?:照片|相片|photo)|(?:照片|相片).{0,8}(?:不要|不看|算了)/iu.test(
      text,
    );
  const request =
    /(?:看|瞧|给我|让我|分享|展示|出示|拿出|想要).{0,12}(?:照片|相片)|(?:照片|相片).{0,12}(?:看看|给我|展示|瞧|可以吗|好吗)|(?:show|see|look at).{0,20}photo/iu.test(
      text,
    );
  return request && !refused;
}

export function validateStory(plan: ReplyPlan, input: string, facts: Facts): void {
  const asked = photoRequested(input);
  let photoProposed = facts.photo_revealed;
  for (const segment of plan.segments) {
    const hasPhoto = segment.events.some((event) => event.type === 'photo');
    if ((hasPhoto || segment.action === 'offerPhoto') && !asked)
      throw new AppError('INVALID_PLAN', 502, '她还没有准备好这个回应。', true);
    if (segment.action === 'offerPhoto' && !hasPhoto)
      throw new AppError('INVALID_PLAN', 502, '她还没有准备好这个回应。', true);
    for (const event of segment.events) {
      if (event.type === 'photo') photoProposed = true;
      if (event.type === 'environment' && !photoProposed)
        throw new AppError('INVALID_PLAN', 502, '她还没有准备好这个回应。', true);
    }
  }
}
