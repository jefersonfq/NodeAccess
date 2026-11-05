"""Private stdlib trace wrapper and Cobertura exporter for the real TLS lab."""
import dis
import hashlib
import json
import os
import pathlib
import runpy
import sys
import trace
import types
import uuid
import xml.etree.ElementTree as ET

TARGET = pathlib.Path(__file__).resolve().parent / 'tacacs-client.py'
SOURCE_HASH = hashlib.sha256(TARGET.read_bytes()).hexdigest()


def executable_lines(code):
    lines = {line for _, line in dis.findlinestarts(code) if line > 0}
    for constant in code.co_consts:
        if isinstance(constant, types.CodeType):
            lines.update(executable_lines(constant))
    return lines


def export(directory, output, run_id, helper_sample=None):
    lines = executable_lines(compile(TARGET.read_bytes(), str(TARGET), 'exec'))
    counts = dict.fromkeys(lines, 0)
    samples = list(directory.glob('*.json'))
    if not samples:
        raise RuntimeError('PYTHON_COVERAGE_NO_SAMPLES')
    for sample in samples:
        data = json.loads(sample.read_text())
        if data['runId'] != run_id or data['sourceSha256'] != SOURCE_HASH or data['source'] != str(TARGET):
            raise RuntimeError('PYTHON_COVERAGE_SOURCE_MISMATCH')
        for line, hits in data['counts'].items():
            line = int(line)
            if line not in counts or type(hits) is not int or hits < 0:
                raise RuntimeError('PYTHON_COVERAGE_INVALID_COUNT')
            counts[line] += hits
    targets = [(TARGET, counts)]
    helper = pathlib.Path(__file__).resolve()
    helper_hash = hashlib.sha256(helper.read_bytes()).hexdigest()
    if helper_sample is not None:
        data = json.loads(pathlib.Path(helper_sample).read_text())
        if data['runId'] != run_id or data['sourceSha256'] != helper_hash or data['source'] != str(helper):
            raise RuntimeError('PYTHON_COVERAGE_HELPER_MISMATCH')
        helper_counts = dict.fromkeys(executable_lines(compile(helper.read_bytes(), str(helper), 'exec')), 0)
        for line, hits in data['counts'].items():
            line = int(line)
            if line not in helper_counts or type(hits) is not int or hits < 0:
                raise RuntimeError('PYTHON_COVERAGE_INVALID_HELPER_COUNT')
            helper_counts[line] += hits
        targets.append((helper, helper_counts))
    covered = sum(hits > 0 for hits in counts.values())
    total_valid = sum(len(target_counts) for _, target_counts in targets)
    total_covered = sum(hits > 0 for _, target_counts in targets for hits in target_counts.values())
    rate = str(total_covered / total_valid)
    xml = ET.Element('coverage', {'version': '1', 'line-rate': rate, 'branch-rate': '0',
                                'lines-covered': str(total_covered), 'lines-valid': str(total_valid)})
    sources = ET.SubElement(xml, 'sources')
    ET.SubElement(sources, 'source').text = '.'
    package = ET.SubElement(ET.SubElement(xml, 'packages'), 'package', {'name': 'network-access', 'line-rate': rate, 'branch-rate': '0'})
    classes = ET.SubElement(package, 'classes')
    for target, target_counts in targets:
        target_rate = str(sum(hits > 0 for hits in target_counts.values()) / len(target_counts))
        cls = ET.SubElement(classes, 'class', {'name': target.stem, 'filename': 'tools/network-access/' + target.name, 'line-rate': target_rate, 'branch-rate': '0'})
        entries = ET.SubElement(cls, 'lines')
        for line, hits in sorted(target_counts.items()):
            ET.SubElement(entries, 'line', {'number': str(line), 'hits': str(hits)})
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = ET.tostring(xml, encoding='utf-8', xml_declaration=True)
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
        stream.write(payload)
    print(json.dumps({'sourceSha256': SOURCE_HASH, 'reportSha256': hashlib.sha256(payload).hexdigest(),
                      'executedLines': covered, 'totalLines': len(lines), 'helperSourceSha256': helper_hash}))


if __name__ == '__main__':
    directory = pathlib.Path(os.environ['NODEACCESS_PYTHON_COUNTS'])
    run_id = os.environ['NODEACCESS_TLS_COVERAGE_RUN_ID']
    if sys.argv[1] == '--export':
        export(directory, pathlib.Path(sys.argv[2]), run_id, os.environ.get('NODEACCESS_PYTHON_HELPER_COUNTS'))
    else:
        if pathlib.Path(sys.argv[1]).resolve() != TARGET:
            raise RuntimeError('PYTHON_COVERAGE_UNEXPECTED_TARGET')
        tracer = trace.Trace(count=True, trace=False, ignoredirs=[sys.prefix, sys.exec_prefix])
        sys.argv = sys.argv[1:]
        try:
            tracer.runfunc(runpy.run_path, str(TARGET), run_name='__main__')
        finally:
            counts = {str(line): hits for (filename, line), hits in tracer.results().counts.items()
                      if pathlib.Path(filename).resolve() == TARGET}
            data = {'runId': run_id, 'sourceSha256': SOURCE_HASH, 'source': str(TARGET), 'counts': counts}
            destination = directory / (str(uuid.uuid4()) + '.json')
            with os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
                json.dump(data, stream)
