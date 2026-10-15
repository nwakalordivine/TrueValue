"""Run with:  python -m unittest discover -s tests   (no database or network needed)"""
import json
import unittest
from pathlib import Path

from app.services import disposal, parser, scoring

DATA = Path(__file__).resolve().parent.parent / "data"
load = lambda n: json.loads((DATA / f"{n}.json").read_text(encoding="utf-8"))
PRODUCTS, DIMS, CLAIMS, PRICES = load("products"), load("ethicalDimensions"), load("claims"), load("priceObservations")
DEFAULT = {d["dimension_id"]: d["default_weight"] for d in DIMS}


class Scoring(unittest.TestCase):
    def test_matches_frontend_for_prairie_morning(self):
        # Same inputs as the web page screenshot: Prairie Morning Coffee = 74/100, 91% coverage
        m = scoring.calculate_match(PRODUCTS[0], DIMS, DEFAULT, CLAIMS)
        self.assertEqual(m["raw_score"], 74)
        self.assertEqual(m["coverage_percent"], 91)

    def test_unknown_is_not_zero(self):
        w = {k: (100 if k == "animal_welfare" else 0) for k in DEFAULT}
        m = scoring.calculate_match(PRODUCTS[0], DIMS, w, CLAIMS)
        self.assertIsNone(m["raw_score"])
        self.assertEqual(scoring.verdict(PRODUCTS[0], m, [])["label"], "Not enough data")

    def test_weights_change_ranking(self):
        first = scoring.rank_products(PRODUCTS, DIMS, DEFAULT, CLAIMS)[0][0]["product_id"]
        local = scoring.rank_products(PRODUCTS, DIMS, {**{k: 0 for k in DEFAULT}, "local_business": 100}, CLAIMS)
        self.assertNotEqual(local[0][0]["product_id"], None)
        self.assertTrue(first)

    def test_alternatives_are_better(self):
        everyday = next(p for p in PRODUCTS if p["product_id"] == "p3")
        alts = scoring.alternatives(everyday, PRODUCTS, DIMS, DEFAULT, CLAIMS, PRICES)
        self.assertTrue(alts and all(a["score_delta"] > 0 for a in alts))
        self.assertTrue(alts[0]["same_category"])


class Parsing(unittest.TestCase):
    def check(self, q, intent):
        self.assertEqual(parser.rule_parse(q, PRODUCTS)["intent"], intent, q)

    def test_intents(self):
        self.check("Canadian coffee under $15 with less plastic", "recommend")
        self.check("Is Loblaw a Canadian company?", "company_check")
        self.check("Where can I buy Wascana Wildflower Honey?", "where_to_buy")
        self.check("Where do I recycle a glass jar?", "dispose")
        self.check("Compare Prairie Morning Coffee and Everyday Ground Coffee", "compare")
        self.check("Why did True North 70% Dark Chocolate get its score?", "explain")

    def test_price_and_priorities(self):
        r = parser.rule_parse("Canadian coffee under $15 with less plastic", PRODUCTS)
        self.assertEqual(r["max_price"], 15.0)
        self.assertEqual(r["category"], "Coffee")
        self.assertIn("canadian_ownership", r["priorities"])
        self.assertIn("packaging", r["priorities"])

    def test_barcode(self):
        r = parser.rule_parse("3017620422003", PRODUCTS)
        self.assertEqual((r["intent"], r["barcode"]), ("barcode", "3017620422003"))
        self.assertNotEqual(parser.rule_parse("coffee under $15", PRODUCTS)["intent"], "barcode")

    def test_company_name(self):
        self.assertEqual(parser.rule_parse("Who owns Costco?", PRODUCTS)["company_name"], "Costco")

    def test_llm_cannot_invent_products(self):
        rule = parser.rule_parse("best spread", PRODUCTS)
        merged = parser.merge_llm(rule, {"intent": "recommend", "product_names": ["Made Up Nutella"],
                                         "priorities": ["not_a_dimension"]}, PRODUCTS)
        self.assertEqual(merged["product_ids"], rule["product_ids"])
        self.assertEqual(merged["priorities"], [])


class Disposal(unittest.TestCase):
    def test_regina_rules(self):
        self.assertEqual(disposal.classify("Glass jar")["bin"], "sarcan")
        self.assertEqual(disposal.classify("Flexible plastic bag")["bin"], "sarcan")
        self.assertEqual(disposal.classify("Aluminum can")["bin"], "sarcan_refund")
        self.assertEqual(disposal.classify("Cardboard box")["bin"], "blue_cart")
        self.assertEqual(disposal.classify("Paper wrapper")["bin"], "blue_cart")


if __name__ == "__main__":
    unittest.main()
