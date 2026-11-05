"""Exercise exporter trust boundaries; synthetic samples never enter lab counts."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import trace

HELPER = Path(__file__).with_name('tls-python-coverage.py').resolve()
spec = importlib.util.spec_from_file_location('tls_coverage', HELPER)
module = importlib.util.module_from_spec(spec)
tracer = trace.Trace(count=True, trace=False)
tracer.runfunc(spec.loader.exec_module, module)


def verify():
    with tempfile.TemporaryDirectory(prefix='tls-coverage-contract-') as directory:
        samples = Path(directory) / 'samples'
        samples.mkdir()
        output = Path(directory) / 'result.xml'
        def rejected(pattern):
            try:
                module.export(samples, output, 'test-run')
            except RuntimeError as error:
                assert pattern in str(error)
            else:
                raise AssertionError('Invalid evidence accepted')
        rejected('NO_SAMPLES')
        valid = {'runId': 'test-run', 'sourceSha256': module.SOURCE_HASH,
                 'source': str(module.TARGET), 'counts': {'1': 1}}
        sample = samples / 'sample.json'
        for key in ('runId', 'sourceSha256', 'source'):
            sample.write_text(json.dumps({**valid, key: 'stale'}))
            rejected('SOURCE_MISMATCH')
        for counts in ({'999999': 1}, {'1': -1}, {'1': True}, {'1': '1'}):
            sample.write_text(json.dumps({**valid, 'counts': counts}))
            rejected('INVALID_COUNT')
        line = min(module.executable_lines(compile(module.TARGET.read_bytes(), str(module.TARGET), 'exec')))
        sample.write_text(json.dumps({**valid, 'counts': {str(line): 2}}))
        with contextlib.redirect_stdout(io.StringIO()) as captured:
            module.export(samples, output, 'test-run')
        proof = json.loads(captured.getvalue())
        assert proof['executedLines'] == 1
        assert proof['reportSha256'] == hashlib.sha256(output.read_bytes()).hexdigest()
        assert proof['totalLines'] > 1
        try:
            module.export(samples, output, 'test-run')
        except FileExistsError:
            pass
        else:
            raise AssertionError('Existing report overwritten')

        helper_sample = Path(directory) / 'helper.json'
        helper_valid = {'runId': 'test-run', 'sourceSha256': hashlib.sha256(HELPER.read_bytes()).hexdigest(),
                        'source': str(HELPER), 'counts': {'1': 1}}
        helper_output = Path(directory) / 'helper.xml'
        for key in ('runId', 'sourceSha256', 'source'):
            helper_sample.write_text(json.dumps({**helper_valid, key: 'stale'}))
            try:
                module.export(samples, helper_output, 'test-run', helper_sample)
            except RuntimeError as error:
                assert 'HELPER_MISMATCH' in str(error)
            else:
                raise AssertionError('Invalid helper evidence accepted')
        for counts in ({'999999': 1}, {'1': -1}, {'1': True}):
            helper_sample.write_text(json.dumps({**helper_valid, 'counts': counts}))
            try:
                module.export(samples, helper_output, 'test-run', helper_sample)
            except RuntimeError as error:
                assert 'INVALID_HELPER_COUNT' in str(error)
            else:
                raise AssertionError('Invalid helper count accepted')
        helper_sample.write_text(json.dumps(helper_valid))
        with contextlib.redirect_stdout(io.StringIO()):
            module.export(samples, helper_output, 'test-run', helper_sample)
        xml = module.ET.fromstring(helper_output.read_bytes())
        assert len(xml.findall('.//class')) == 2


tracer.runfunc(verify)
counts = {str(line): hits for (filename, line), hits in tracer.results().counts.items()
          if Path(filename).resolve() == HELPER}
proof = {'runId': os.environ['NODEACCESS_TLS_COVERAGE_RUN_ID'],
         'sourceSha256': hashlib.sha256(HELPER.read_bytes()).hexdigest(),
         'source': str(HELPER), 'counts': counts}
with os.fdopen(os.open(os.environ['NODEACCESS_PYTHON_HELPER_COUNTS'], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
    json.dump(proof, stream)
print('Python exporter trust-boundary contracts PASS')
