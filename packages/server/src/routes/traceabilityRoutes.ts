import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { UserRole } from '@m1/shared-validation';
import { TraceabilityService } from '../services/TraceabilityService';
import { ElasticTraceabilityService } from '../services/ElasticTraceabilityService';
import { isElasticAvailable } from '../elastic/elasticClient';

const router = Router();
router.use(require('express').json());
router.use(requireAuth);

/**
 * GET /traceability?q=...
 *
 * When Elasticsearch is available, performs a fuzzy multi-field search first
 * to find the best-matching batch, then resolves the full trace via PostgreSQL.
 * Falls back to pure PostgreSQL ILIKE when ES is unavailable.
 */
router.get('/', requireRole([UserRole.PLANT_HEAD, UserRole.MACHINE_HEAD, UserRole.ADMIN]), async (req, res) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }

    // Try Elasticsearch first for better matching
    if (isElasticAvailable()) {
      const esHits = await ElasticTraceabilityService.search(query);
      if (esHits.length > 0) {
        // Use the top hit's batch_number to resolve full trace via PostgreSQL
        const topHit = esHits[0];
        const result = await TraceabilityService.search(topHit.batch_number);
        return res.json({
          ...result,
          esMatches: esHits.slice(0, 5).map((h) => ({
            batchNumber: h.batch_number,
            coilNo: h.coil_no,
            customer: h.customer_name,
            grade: h.grade_code,
            score: h.score,
          })),
        });
      }
    }

    // Fallback: PostgreSQL ILIKE search
    const result = await TraceabilityService.search(query);
    res.json(result);
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

/**
 * GET /traceability/suggest?q=...
 *
 * Returns autocomplete suggestions from Elasticsearch.
 * Only available when ES is connected.
 */
router.get('/suggest', requireRole([UserRole.PLANT_HEAD, UserRole.MACHINE_HEAD, UserRole.ADMIN]), async (req, res) => {
  try {
    const query = req.query.q as string;
    if (!query || query.trim().length < 2) {
      return res.json([]);
    }

    if (!isElasticAvailable()) {
      return res.json([]);
    }

    const suggestions = await ElasticTraceabilityService.suggest(query);
    res.json(suggestions);
  } catch (error: any) {
    // Non-fatal — return empty suggestions
    res.json([]);
  }
});

export default router;
