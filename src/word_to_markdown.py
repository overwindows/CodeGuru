import pypandoc
import os


def extract(docx_path, output_dir_path):
    """convert docx to markdown"""

    output_md_file_path = os.path.join(output_dir_path, 'design_document.md')
    converted_output = pypandoc.convert_file(
        docx_path, 'md',
        extra_args=[f'--extract-media={output_dir_path}']
    )

    with open(output_md_file_path, 'w', newline='') as output_md_file:
        output_md_file.write(converted_output)

    return converted_output
