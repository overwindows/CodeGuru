import pypandoc


def extract(docx_path, output_dir_path):
    """convert docx to markdown"""
    _ = pypandoc.convert_file(docx_path, 'md', outputfile=f'{output_dir_path}/design_document.md')