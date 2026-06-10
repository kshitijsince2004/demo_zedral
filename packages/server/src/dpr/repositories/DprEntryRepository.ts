import { Kysely } from 'kysely';

export class DprEntryRepository {
  constructor(private db: Kysely<any>) {}

  async saveEntry(monthId: string, dayNumber: number, values: any, delayData: any, provenance: any) {
    return await this.db.insertInto('dpr.daily_entry')
      .values({
        month_id: monthId,
        day_number: dayNumber,
        values: JSON.stringify(values),
        delay_data: JSON.stringify(delayData),
        field_provenance: JSON.stringify(provenance)
      })
      .onConflict((oc) => oc
        .columns(['month_id', 'day_number'])
        .doUpdateSet({
          values: JSON.stringify(values),
          delay_data: JSON.stringify(delayData),
          field_provenance: JSON.stringify(provenance),
          updated_at: new Date()
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getEntriesForMonth(monthId: string) {
    return await this.db.selectFrom('dpr.daily_entry')
      .selectAll()
      .where('month_id', '=', monthId)
      .orderBy('day_number', 'asc')
      .execute();
  }
}
