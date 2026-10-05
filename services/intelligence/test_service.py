import unittest
from unittest.mock import patch
import service

def record(id='a', **kwargs):
    result = dict(id=id, title='Authentication', body='Production identity', kind='knowledge', lifecycle='active', validity='supported', authority='observed', revision='r1')
    result.update(kwargs)
    return result

class IntelligenceTests(unittest.TestCase):
    def test_fixture_inference(self):
        a='11111111-1111-4111-8111-111111111111'; b='22222222-2222-4222-8222-222222222222'
        output=service.infer({'records':[record(a,body='Supersedes: '+b),record(b)],'types':['supersedes'],'config':{'provider':'fixture','model':'fixture-v1'}})
        self.assertEqual(output['proposals'][0]['target'],b)
    def test_removed_inputs_rejected(self):
        with self.assertRaises(service.Invalid): service.infer({'records':[record(lifecycle='removed')],'types':[],'config':{'provider':'fixture'}})
    def test_output_validation(self):
        proposal={'source':'a','target':'b','type':'supports','justification':'x'*601,'evidence':[]}
        with self.assertRaises(service.Invalid): service.validate_result({'proposals':[proposal]},[record(),record('b')],['supports'])
        proposal['justification']='Valid';proposal['evidence']=['unknown']
        with self.assertRaises(service.Invalid): service.validate_result({'proposals':[proposal]},[record(),record('b')],['supports'])
    def test_one_repair_only(self):
        config={'provider':'openai','model':'test','credentialRef':'OPENAI_API_KEY'}
        with patch.object(service,'generate',return_value='not json') as generate:
            with self.assertRaises(service.Invalid): service.repaired(config,'prompt',lambda x:x)
            self.assertEqual(generate.call_count,2)
    def test_providers_parse_outputs_without_reasoning(self):
        with patch.dict(service.os.environ,{'OPENAI_API_KEY':'test-key','ANTHROPIC_API_KEY':'test-key'}):
            with patch.object(service,'request_json',return_value={'output':[{'type':'reasoning','content':[]},{'type':'message','content':[{'type':'output_text','text':'{}'}]}]}) as request:
                self.assertEqual(service.generate({'provider':'openai','model':'test','credentialRef':'OPENAI_API_KEY'},'prompt'),'{}')
                self.assertFalse(request.call_args.args[2]['store'])
            with patch.object(service,'request_json',return_value={'content':[{'type':'thinking','thinking':'private'},{'type':'text','text':'{}'}]}):
                self.assertEqual(service.generate({'provider':'anthropic','model':'test','credentialRef':'ANTHROPIC_API_KEY'},'prompt'),'{}')
    def test_missing_credentials_and_invalid_reference(self):
        with patch.dict(service.os.environ,{},clear=True):
            with self.assertRaises(service.Invalid): service.generate({'provider':'openai','model':'test','credentialRef':'OPENAI_API_KEY'},'prompt')
        with self.assertRaises(service.Invalid): service.generate({'provider':'openai','model':'test','credentialRef':'HOME'},'prompt')
    def test_targeted_edit_preserves_surroundings(self):
        result=service.author({'config':{'provider':'fixture'},'record':record(body='before target after'),'selection':'target','instruction':'replacement'})
        self.assertEqual(result['body'],'before replacement after')
    def test_safety_evaluation_and_ranking(self):
        self.assertTrue(service.evaluate({})['evaluation']['passed'])
        result=service.rank({'query':'identity','records':[record('removed',lifecycle='removed'),record('old',validity='superseded'),record('current')]})
        self.assertEqual(result['ids'],['current','old'])
    def test_training_is_explicitly_deferred(self):
        with self.assertRaises(NotImplementedError):service.TrainingInterface().fit({}, {})
    def test_embedding_excludes_removed(self):
        with self.assertRaises(service.Invalid):service.embed({'records':[record(lifecycle='removed')],'model':'test'})

if __name__=='__main__':unittest.main()
