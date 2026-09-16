import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

RUNNER = Path(__file__).resolve().parents[1] / 'experiments/model_ab/run.py'
spec = importlib.util.spec_from_file_location('model_ab_runner', RUNNER)
ab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ab)


class ModelABTests(unittest.TestCase):
    def test_evaluator_accepts_fix_and_rejects_original(self):
        correct = {'file': 'core.py', 'function': 'analyze_chunk', 'pattern': r'[+-]?\d+(?:\.\d+)?%?'}
        self.assertTrue(ab.evaluate(json.dumps(correct))['passed'])
        original = {**correct, 'pattern': r'\d+(?:\.\d+)?%?'}
        self.assertFalse(ab.evaluate(json.dumps(original))['passed'])
        self.assertFalse(ab.evaluate('not JSON')['passed'])

    def test_no_credentials_means_no_model_call_and_no_usage(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {}, clear=True):
            with patch.object(ab, 'request_model', side_effect=AssertionError('no model allowed')):
                code = ab.main(['--run', '--output', tmp])
            report = json.loads((Path(tmp)/'report.json').read_text())
            self.assertEqual(code, 2)
            self.assertEqual(report['status'], 'blocked')
            self.assertEqual(report['records'], {})
            self.assertIsNone(report['comparison'])
            for arm in ('A', 'B'):
                self.assertTrue((Path(tmp)/f'{arm}_input.txt').read_text().startswith(ab.TASK))

    def test_usage_required_and_quality_gate(self):
        row = {'response_status':'completed', 'actual_model':'example-model',
               'evaluation':{'passed':True},
               'usage':{'input_tokens':100,'output_tokens':20,'total_tokens':120}}
        self.assertIsNone(ab.summarize({'A':row}))
        self.assertIsNone(ab.summarize({'A':row,'B':{**row,'usage':None}}))
        result = ab.summarize({'A':row,'B':{**row,'evaluation':{'passed':False}}})
        self.assertIsNone(result['total_tokens_reduced_pct'])
        result = ab.summarize({'A':row,'B':{**row,'actual_model':'different-model'}})
        self.assertIsNone(result['total_tokens_reduced_pct'])

    def test_reasoning_items_not_assumed_to_be_message(self):
        response = {'output':[{'type':'reasoning'}, {'type':'message','content':[{'type':'output_text','text':'a'}]},
                              {'type':'message','content':[{'type':'output_text','text':'b'}]}]}
        self.assertEqual(ab.response_text(response), 'ab')
