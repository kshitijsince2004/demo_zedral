import { Kysely } from 'kysely';

export class DprSourceMapRepository {
  constructor(private db: Kysely<any>) {}

  async upsert(fieldId: string, status: string, resolutionData: any) {
    return await this.db.insertInto('dpr.source_map')
      .values({
        field_id: fieldId,
        status,
        resolution_data: JSON.stringify(resolutionData)
      })
      .onConflict((oc) => oc
        .column('field_id')
        .doUpdateSet({
          status,
          resolution_data: JSON.stringify(resolutionData),
          updated_at: new Date()
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getAll() {
    return await this.db.selectFrom('dpr.source_map')
      .selectAll()
      .execute();
  }
}
