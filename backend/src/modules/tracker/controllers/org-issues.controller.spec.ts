import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import type { MeetingVisibilityService } from '../../meetings/meeting-visibility.service';
import type { RbacService } from '../../rbac/rbac.service';
import type { ListOrgIssuesQuery } from '../dto/issues/list-org-issues-query.dto';
import type { IssuesService } from '../services/issues.service';

import { OrgIssuesController } from './org-issues.controller';

const baseQuery: ListOrgIssuesQuery = {
  includeArchived: false,
  includeDeleted: false,
  includeChildrenCount: false,
  includeEngagementCount: false,
  page: 1,
  limit: 100,
};

const user = { id: 'u1' } as CurrentUserPayload;

function make() {
  const findAllAcrossProjects = vi.fn(async () => ({
    items: [],
    total: 0,
    page: 1,
    limit: 100,
  }));
  const canRead = vi.fn(async () => true);
  const loadContext = vi.fn(async () => ({
    isSuperAdmin: false,
    role: 'manager',
    visibility: 'strict',
  }));
  const assertCanView = vi.fn(async () => ({}) as never);
  const svc = { findAllAcrossProjects } as unknown as IssuesService;
  const rbac = { canRead, loadContext } as unknown as RbacService;
  const meetingVisibility = {
    assertCanView,
  } as unknown as MeetingVisibilityService;
  const ctrl = new OrgIssuesController(svc, rbac, meetingVisibility);
  return { ctrl, findAllAcrossProjects, assertCanView };
}

describe('OrgIssuesController.list — гейт видимости встречи', () => {
  beforeEach(() => vi.clearAllMocks());

  it('linkedMeetingId задан → assertCanView вызван, meetingAuthorized=true доходит до сервиса', async () => {
    const { ctrl, findAllAcrossProjects, assertCanView } = make();
    await ctrl.list({ ...baseQuery, linkedMeetingId: 'm1' }, user, 't1');
    expect(assertCanView).toHaveBeenCalledWith('m1', 'u1');
    expect(findAllAcrossProjects).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ linkedMeetingId: 'm1' }),
      expect.objectContaining({ meetingAuthorized: true }),
    );
  });

  it('linkedMeetingId НЕ задан → assertCanView не вызван, meetingAuthorized=false', async () => {
    const { ctrl, findAllAcrossProjects, assertCanView } = make();
    await ctrl.list(baseQuery, user, 't1');
    expect(assertCanView).not.toHaveBeenCalled();
    expect(findAllAcrossProjects).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.anything(),
      expect.objectContaining({ meetingAuthorized: false }),
    );
  });

  it('assertCanView бросает → ошибка пробрасывается, сервис не вызван', async () => {
    const { ctrl, findAllAcrossProjects, assertCanView } = make();
    assertCanView.mockRejectedValueOnce(new Error('meeting_not_visible'));
    await expect(
      ctrl.list({ ...baseQuery, linkedMeetingId: 'mX' }, user, 't1'),
    ).rejects.toThrow();
    expect(findAllAcrossProjects).not.toHaveBeenCalled();
  });
});
