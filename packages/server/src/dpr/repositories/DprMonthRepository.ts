import { Kysely } from 'kysely';

export class DprMonthRepository {
  constructor(private db: Kysely<any>) {}

  async create(templateId: string, year: number, month: number, sheetCode: string, daysInMonth: number, configOverrides: any) {
    return await this.db.insertInto('dpr.month')
      .values({
        template_id: templateId,
        year,
        month,
        sheet_code: sheetCode,
        days_in_month: daysInMonth,
        config_overrides: JSON.stringify(configOverrides)
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findById(id: string) {
    return await this.db.selectFrom('dpr.month')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }
}
